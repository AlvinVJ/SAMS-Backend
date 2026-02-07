import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";

interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}

async function getUserNameFromUid(uid: string): Promise<string> {
  const account = await prisma.userAccount.findUnique({
    where: { mits_uid: uid },
    include: { Faculty: true, Student: true },
  });
  if (account?.Faculty?.name) return account.Faculty.name;
  if (account?.Student?.name) return account.Student.name;
  return "Unknown User";
}

async function resolveApproversForRole(roleTag: string, requesterUid: string): Promise<string[]> {
  const normalizedTag = roleTag.toLowerCase();
  if (normalizedTag === "class_advisor") {
    const student = await prisma.student.findUnique({
      where: { mits_uid: requesterUid },
      select: { class_id: true },
    });
    if (!student || !student.class_id) return [];
    const advisors = await prisma.classFaculty.findMany({
      where: {
        class_id: student.class_id,
        role_tag: { equals: "class_advisor", mode: 'insensitive' },
        is_active: true,
        deleted_at: null,
      },
      select: { mits_uid: true },
    });
    return advisors.map(a => a.mits_uid);
  }
  const role = await prisma.roles.findFirst({
    where: { role_tag: { equals: normalizedTag, mode: 'insensitive' } },
    select: { role_id: true },
  });
  if (!role) return [];
  const mappings = await prisma.roleMapping.findMany({
    where: { role_id: role.role_id, is_active: true, deleted_at: null },
    select: { mits_uid: true },
  });
  return mappings.map(m => m.mits_uid);
}

export async function getRequestsToApproveService(payload: any) {
  try {
    const { mits_uid } = payload.user;
    const selectedRole = (payload.query?.role as string)?.toLowerCase();

    if (!selectedRole) {
      return { success: false, statusCode: 400, message: "Role parameter is required" };
    }

    const pendingRequests = await prisma.requests.findMany({
      where: { status: 0 },
      include: {
        Procedures: true,
        UserAccount: {
          include: {
            Student: {
              include: {
                Classes: {
                  include: { Departments: true }
                }
              }
            }
          }
        }
      },
    });

    const approvableRequests: any[] = [];

    for (const req of pendingRequests) {
      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (!snap.exists) continue;

      const data = snap.data()!;
      const currentLevel = data.current_level;

      const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
      const procedureDef = procDoc.exists ? procDoc.data() : null;
      const levelDef = procedureDef?.approvalLevels?.find((l: any) => l.level === currentLevel);
      const allowedRoles = (levelDef?.roleIds || [levelDef?.role] || []).map((r: string) => r?.toLowerCase());

      if (!allowedRoles.includes(selectedRole)) continue;

      const approvalHistory: any[] = [];
      const historyBlocks = (data.approval_progress || []).filter((lvl: any) => lvl.level < currentLevel);
      for (const block of historyBlocks) {
        const levelDefHistory = procedureDef?.approvalLevels?.find((l: any) => l.level === block.level);
        const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
        for (const decision of block.decisions) {
          if (decision.decision) {
            approvalHistory.push({
              level: block.level,
              approverName: await getUserNameFromUid(decision.mits_uid),
              role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
              status: decision.decision,
              comments: decision.comments,
              timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
            });
          }
        }
      }

      const levelBlock = data.approval_progress?.find((lvl: any) => lvl.level === currentLevel);
      if (!levelBlock || levelBlock.net_status !== "PENDING") continue;
      if (levelBlock.decisions.find((d: any) => d.mits_uid === mits_uid && d.decision)) continue;

      approvableRequests.push({
        id: req.req_id,
        type: req.Procedures?.title || "Request",
        studentName: req.UserAccount?.Student?.name || data.studentName || "Unknown",
        studentId: req.created_by,
        department: req.UserAccount?.Student?.Classes?.Departments?.dept_name || "N/A",
        date: req.created_at.toISOString().split("T")[0],
        description: data.formData ? Object.entries(data.formData).map(([k, v]) => `${k}: ${v}`).join(" | ") : "No description",
        attachments: data.attachments || [],
        roleTag: selectedRole,
        color: "blue",
        formData: data.formData || {},
        approvalHistory: approvalHistory
      });
    }

    return { success: true, statusCode: 200, message: "Pending requests fetched", data: { requests: approvableRequests } };
  } catch (error: any) {
    console.error("getRequestsToApproveService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function approveRequestService(payload: any): Promise<Result> {
  try {
    const { mits_uid } = payload.user;
    const { requestId, role, comments } = payload.body;
    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request not found" };

    const data = snap.data()!;
    const approvalProgress = data.approval_progress || [];
    const currentLevel = data.current_level;
    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    const myDecision = levelBlock?.decisions.find((d: any) => d.mits_uid === mits_uid);
    if (!myDecision) return { success: false, statusCode: 403, message: "Not authorized" };

    myDecision.decision = "APPROVED";
    myDecision.timestamp = new Date().toISOString();
    myDecision.comments = comments || null;
    myDecision.role = role;

    const approvalsDone = levelBlock.decisions.filter((d: any) => d.decision === "APPROVED").length;
    if (approvalsDone >= levelBlock.required_approvals) {
      levelBlock.net_status = "APPROVED";
      const procSnap = await firestore.collection("procedures").doc(data.procId).get();
      const procedure = procSnap.data();
      const nextLevelNum = currentLevel + 1;
      const nextLevelDef = procedure?.approvalLevels?.find((l: any) => l.level === nextLevelNum);

      if (nextLevelDef) {
        data.current_level = nextLevelNum;
        let nextApprovers: string[] = [];
        for (const roleTag of (nextLevelDef.roleIds || [nextLevelDef.role])) {
          const uids = await resolveApproversForRole(roleTag, data.studentId);
          nextApprovers.push(...uids);
        }
        nextApprovers = [...new Set(nextApprovers)];
        approvalProgress.push({
          level: nextLevelNum,
          net_status: "PENDING",
          required_approvals: nextLevelDef.allMustApprove ? nextApprovers.length : (nextLevelDef.minApprovals || 1),
          decisions: nextApprovers.map(uid => ({ mits_uid: uid }))
        });
      } else {
        data.status = "APPROVED";
        await prisma.requests.update({ where: { req_id: requestId }, data: { status: 1 } });
      }
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      current_level: data.current_level,
      status: data.status,
      last_updated_at: new Date().toISOString()
    });
    return { success: true, statusCode: 200, message: "Request approved" };
  } catch (error) {
    console.error("approveRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function rejectRequestService(payload: any): Promise<Result> {
  try {
    const { mits_uid } = payload.user;
    const { requestId, role, reason } = payload.body;

    if (!requestId || !role || !reason) {
      return { success: false, statusCode: 400, message: "requestId, role, and reason are required" };
    }

    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request not found" };

    const data = snap.data()!;
    const approvalProgress = data.approval_progress || [];
    const currentLevel = data.current_level;
    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    const myDecision = levelBlock?.decisions.find((d: any) => d.mits_uid === mits_uid);

    if (myDecision) {
      myDecision.decision = "REJECTED";
      myDecision.timestamp = new Date().toISOString();
      myDecision.comments = reason; // Save as comments for timeline
      myDecision.role = role;
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      status: "REJECTED",
      rejection_info: {
        rejected_by: mits_uid,
        role: role,
        reason: reason,
        timestamp: new Date().toISOString()
      },
      last_updated_at: new Date().toISOString()
    });

    await prisma.requests.update({
      where: { req_id: requestId },
      data: { status: 2 }
    });

    return { success: true, statusCode: 200, message: "Request rejected" };
  } catch (error) {
    console.error("rejectRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getActedRequestsService(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "Faculty account not found" };
    const facultyUid = userAccount.mits_uid;

    const requestsSnap = await firestore.collection("requests").get();
    const actedRequests: any[] = [];

    for (const doc of requestsSnap.docs) {
      const data = doc.data();
      let actedOn = false;
      for (const level of (data.approval_progress || [])) {
        if (level.decisions?.some((d: any) => d.mits_uid === facultyUid && d.decision)) {
          actedOn = true;
          break;
        }
      }
      if (actedOn) {
        const req_id = doc.id;
        const prismaReq = await prisma.requests.findUnique({ where: { req_id }, include: { Procedures: true } });
        const procDoc = await firestore.collection("procedures").doc(prismaReq?.proc_id || "").get();
        const total_levels = procDoc.exists ? (procDoc.data()?.approvalLevels?.length || 1) : 1;

        let status_text = "Pending";
        let color = "warning";
        if (prismaReq?.status === 1) { status_text = "Approved"; color = "success"; }
        else if (prismaReq?.status === 2) { status_text = "Rejected"; color = "error"; }
        else if (prismaReq) {
          const activeLevel = procDoc.data()?.approvalLevels?.find((l: any) => l.level === data.current_level);
          const roleName = (activeLevel?.role || activeLevel?.roleIds?.[0] || "Approver").replaceAll('_', ' ').toUpperCase();
          status_text = `Pending ${roleName}`;
        }

        const userData = await prisma.userAccount.findUnique({
          where: { mits_uid: prismaReq?.created_by || "" },
          include: { Student: { include: { Classes: { include: { Departments: true } } } } }
        });

        let approvalHistory: any[] = [];
        const historyBlocks = (data.approval_progress || []);
        for (const block of historyBlocks) {
          const levelDefHistory = procDoc.data()?.approvalLevels?.find((l: any) => l.level === block.level);
          const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
          for (const decision of block.decisions) {
            if (decision.decision) {
              const histEntry = {
                level: block.level,
                approverName: await getUserNameFromUid(decision.mits_uid),
                role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
                status: decision.decision,
                comments: decision.comments,
                timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
              };
              console.log(`[DEBUG] History entry for ${req_id} level ${block.level}:`, histEntry);
              approvalHistory.push(histEntry);
            }
          }
        }

        actedRequests.push({
          req_id,
          procedure_title: prismaReq?.Procedures?.title || "Unknown Request",
          created_at: prismaReq?.created_at,
          status: prismaReq?.status,
          status_text,
          color,
          current_level: data.current_level || 1,
          total_levels,
          formData: data.formData || {},
          studentName: userData?.Student?.name || data.studentName || "Unknown",
          studentId: prismaReq?.created_by,
          department: userData?.Student?.Classes?.Departments?.dept_name || "N/A",
          roleTag: (procDoc.data()?.approvalLevels?.find((l: any) => l.level === data.current_level)?.role || "Approver"),
          approvalHistory: approvalHistory
        });
      }
    }
    return { success: true, statusCode: 200, message: "Acted requests fetched", data: actedRequests };
  } catch (error) {
    console.error("getActedRequestsService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}
