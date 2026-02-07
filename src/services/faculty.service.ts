import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";

interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}

// FIX: Helper to get name from UID
async function getUserNameFromUid(uid: string): Promise<string> {
  const account = await prisma.userAccount.findUnique({
    where: { mits_uid: uid },
    include: { Faculty: true, Student: true },
  });
  if (account?.Faculty?.name) return account.Faculty.name;
  if (account?.Student?.name) return account.Student.name;
  return "Unknown User";
}

// Helper: Resolve Approvers
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
    const { mits_uid, role: userType } = payload.user;
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

      // Extract Approval History
      const approvalHistory: any[] = [];
      const historyBlocks = (data.approval_progress || []).filter((lvl: any) => lvl.level < currentLevel);
      
      for (const block of historyBlocks) {
        const levelDefHistory = procedureDef?.approvalLevels?.find((l: any) => l.level === block.level);
        const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";

        for (const decision of block.decisions) {
          if (decision.decision) {
            const approverName = await getUserNameFromUid(decision.mits_uid);
            approvalHistory.push({
              level: block.level,
              approverName: approverName,
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

      const myDecisionEntry = levelBlock.decisions.find((d: any) => d.mits_uid === mits_uid);
      if (!myDecisionEntry || myDecisionEntry.decision) continue;

      let descriptionSummary = "";
      if (data.formData) {
           descriptionSummary = Object.entries(data.formData)
             .map(([key, val]) => `${key}: ${val}`)
             .join(" | ");
      }

      approvableRequests.push({
        id: req.req_id,
        type: req.Procedures?.title || "Request",
        studentName: req.UserAccount?.Student?.name || data.studentName || "Unknown",
        studentId: req.created_by,
        department: req.UserAccount?.Student?.Classes?.Departments?.dept_name || "N/A",
        date: req.created_at.toISOString().split("T")[0],
        description: descriptionSummary || "No description provided.",
        attachments: data.attachments || [],
        roleTag: selectedRole,
        color: "blue",
        formData: data.formData || {},
        approvalHistory: approvalHistory
      });
    }

    return {
      success: true,
      statusCode: 200,
      message: "Pending requests fetched",
      data: { requests: approvableRequests },
    };
  } catch (error: any) {
    console.error("getRequestsToApproveService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function approveRequestService(payload: any): Promise<Result> {
  try {
    const { mits_uid } = payload.user;
    const { requestId, role, comments } = payload.body;

    if (!requestId || !role) {
      return { success: false, statusCode: 400, message: "requestId and role are required" };
    }

    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();

    if (!snap.exists) {
      return { success: false, statusCode: 404, message: "Request not found" };
    }

    const data = snap.data()!;
    const approvalProgress = data.approval_progress || [];
    const currentLevel = data.current_level;

    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    if (!levelBlock || levelBlock.net_status !== "PENDING") {
      return { success: false, statusCode: 400, message: "Level not found or not pending" };
    }

    const myDecision = levelBlock.decisions.find((d: any) => d.mits_uid === mits_uid);
    if (!myDecision) {
      return { success: false, statusCode: 403, message: "Not authorized" };
    }

    myDecision.decision = "APPROVED";
    myDecision.timestamp = new Date().toISOString();
    myDecision.comments = comments || null;
    myDecision.role = role; // NEW: Save acting role

    const approvalsDone = levelBlock.decisions.filter((d: any) => d.decision === "APPROVED").length;

    if (approvalsDone >= levelBlock.required_approvals) {
      levelBlock.net_status = "APPROVED";

      const procSnap = await firestore.collection("procedures").doc(data.procId || data.proc_id).get();
      const procedure = procSnap.data();
      const nextLevelNum = currentLevel + 1;
      const nextLevelDef = procedure?.approvalLevels?.find((l: any) => l.level === nextLevelNum);

      if (nextLevelDef) {
        data.current_level = nextLevelNum;
        let nextApprovers: string[] = [];
        const roleIds = nextLevelDef.roleIds || [nextLevelDef.role]; 
        for (const roleTag of roleIds) {
          const uids = await resolveApproversForRole(roleTag, data.studentId || data.created_by);
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
        await prisma.requests.update({
          where: { req_id: requestId },
          data: { status: 1 } 
        });
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

    if (!snap.exists) {
      return { success: false, statusCode: 404, message: "Request not found" };
    }

    await requestRef.update({
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
