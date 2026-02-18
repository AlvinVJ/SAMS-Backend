import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";

interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// Helper: Resolve Name from UID
export async function getUserNameFromUid(uid: string): Promise<string> {
  const account = await prisma.userAccount.findUnique({
    where: { mits_uid: uid },
    include: { Faculty: true, Student: true },
  });
  if (account?.Faculty?.name) return account.Faculty.name;
  if (account?.Student?.name) return account.Student.name;
  return "Unknown User";
}

// Helper: Resolve Status Text and Color
export async function resolveRequestStatus(req: any, procData: any, currentLevel: number): Promise<{ text: string, color: string }> {
  if (req.status === 1) return { text: "Approved", color: "success" };
  if (req.status === 2) return { text: "Rejected", color: "error" };

  const activeLevel = procData?.approvalLevels?.find((l: any) => l.level === currentLevel);
  const roleName = (activeLevel?.role || activeLevel?.roleIds?.[0] || "Approver").replaceAll('_', ' ').toUpperCase();
  return { text: `Pending ${roleName}`, color: "warning" };
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

export async function createRequest(payload: { body: any; user: any }): Promise<Result> {
  try {
    const { procedureId, formData } = payload.body;
    const { uid, email, name: tokenName } = payload.user;
    const procedure = await prisma.procedures.findUnique({ where: { proc_id: procedureId } });
    if (!procedure || !procedure.is_active) {
      return { success: false, statusCode: 404, message: "Procedure not found" };
    }
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: uid } });
    if (!userAccount) {
      return { success: false, statusCode: 404, message: "User account not linked" };
    }
    const student = await prisma.student.findUnique({ where: { mits_uid: userAccount.mits_uid } });
    const studentName = student?.name || tokenName || email || "Student";
    const procDoc = await firestore.collection("procedures").doc(procedureId).get();
    let approvalLevelsDefinition = procDoc.exists ? (procDoc.data()?.approvalLevels || []) : [];

    const requestId = generateId();
    const nowISO = new Date().toISOString();
    let approval_progress = [];

    const level1Def = approvalLevelsDefinition.find((l: any) => l.level === 1);
    let toApproveData: any[] = [];

    if (level1Def) {
      let level1Approvers: string[] = [];
      const roleTags = level1Def.roleIds || [level1Def.role];

      for (const tag of roleTags) {
        if (typeof tag === 'string') {
          const uids = await resolveApproversForRole(tag, userAccount.mits_uid);
          level1Approvers.push(...uids);
        }
      }
      level1Approvers = [...new Set(level1Approvers)];
      approval_progress.push({
        level: 1,
        net_status: "PENDING",
        required_approvals: level1Def.allMustApprove ? level1Approvers.length : (level1Def.minApprovals || 1),
        decisions: level1Approvers.map(uid => ({
          mits_uid: uid,
          decision: null,
          timestamp: null,
          comments: null
        }))
      });

      // Prepare ToApprove buffer data
      toApproveData = level1Approvers.map(uid => ({
        req_id: requestId,
        approverUID: uid,
        approvalLevel: 1,
        approvalType: (level1Def.roleIds || [level1Def.role])?.[0] || "Approver"
      }));
    }

    // 1. Create SQL Request record FIRST (to satisfy foreign key in ToApprove)
    await prisma.requests.create({
      data: {
        req_id: requestId,
        proc_id: procedureId,
        created_by: userAccount.mits_uid,
        status: 0,
      },
    });

    // 2. Populate ToApprove buffer table in SQL
    if (toApproveData.length > 0) {
      await prisma.toApprove.createMany({
        data: toApproveData,
        skipDuplicates: true
      });
    }

    // 3. Create Firestore record
    await firestore.collection("requests").doc(requestId).set({
      reqId: requestId,
      procId: procedureId,
      studentId: userAccount.mits_uid,
      authUid: uid,
      studentName: studentName,
      studentEmail: email || "",
      status: "PENDING",
      current_level: 1,
      totalLevels: approvalLevelsDefinition.length,
      createdAt: nowISO,
      updatedAt: nowISO,
      last_updated_at: nowISO,
      formData: formData,
      timeline: [{ action: "SUBMITTED", by: studentName, role: "STUDENT", timestamp: nowISO }],
      approval_progress: approval_progress
    });
    return { success: true, statusCode: 201, message: "Request created", data: { requestId } };
  } catch (error: any) {
    console.error("createRequest error:", error);
    return { success: false, statusCode: 500, message: "Internal server error: " + error.message };
  }
}

export async function getMyRequests(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "User not found" };

    const requests = await prisma.requests.findMany({
      where: { created_by: userAccount.mits_uid },
      include: { Procedures: true },
      orderBy: { created_at: 'desc' }
    });

    const formatted = [];

    for (const req of requests) {
      let current_level = 1;
      let total_levels = 1;
      let approvalHistory: any[] = [];
      let status_text = "Pending";
      let color = "warning";

      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (snap.exists) {
        const data = snap.data()!;
        current_level = data.current_level || 1;

        const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
        const procData = procDoc.exists ? procDoc.data() : null;
        total_levels = procData?.approvalLevels?.length || 1;

        const statusResult = await resolveRequestStatus(req, procData, current_level);
        status_text = statusResult.text;
        color = statusResult.color;

        const historyBlocks = (data.approval_progress || []);
        for (const block of historyBlocks) {
          const levelDefHistory = procData?.approvalLevels?.find((l: any) => l.level === block.level);
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
              console.log(`[DEBUG] History entry for ${req.req_id} level ${block.level}:`, histEntry);
              approvalHistory.push(histEntry);
            }
          }
        }
        const userData = await prisma.userAccount.findUnique({
          where: { mits_uid: req.created_by },
          include: { Student: { include: { Classes: { include: { Departments: true } } } } }
        });

        const lastLevel = (procData as any)?.approvalLevels?.length > 0
          ? (procData as any).approvalLevels[(procData as any).approvalLevels.length - 1]
          : null;
        const lastLevelRoleTag = lastLevel?.role || lastLevel?.roleIds?.[0] || "Approver";

        formatted.push({
          req_id: req.req_id,
          procedure_title: req.Procedures?.title || "Unknown Request",
          created_at: req.created_at,
          status: req.status,
          status_text,
          color,
          current_level,
          total_levels,
          approvalHistory,
          formData: data.formData || data.form_response || {},
          studentName: userData?.Student?.name || data.studentName || "Unknown",
          studentId: req.created_by,
          department: userData?.Student?.Classes?.Departments?.dept_name || "N/A",
          lastLevelRoleTag,
        });
        console.log(`[DEBUG] Final formatted request ${req.req_id}:`, {
          status: status_text,
          historyCount: approvalHistory.length
        });
      }
    }

    return { success: true, statusCode: 200, message: "Requests fetched", data: formatted };
  } catch (error) {
    console.error("getMyRequests error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getStudentDashboardData(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "User not found" };

    const mits_uid = userAccount.mits_uid;

    // 1. Fetch Stats
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.requests.count({ where: { created_by: mits_uid, status: 0 } }),
      prisma.requests.count({ where: { created_by: mits_uid, status: 1 } }),
      prisma.requests.count({ where: { created_by: mits_uid, status: 2 } }),
    ]);

    // 2. Fetch Latest Requests (Latest 3)
    const latestRequestsRaw = await prisma.requests.findMany({
      where: { created_by: mits_uid },
      include: { Procedures: true },
      orderBy: { created_at: 'desc' },
      take: 3,
    });

    const activeRequests = [];
    for (const req of latestRequestsRaw) {
      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (snap.exists) {
        const data = snap.data()!;
        const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
        const procData = procDoc.exists ? procDoc.data() : null;

        const { text: status } = await resolveRequestStatus(req, procData, data.current_level || 1);

        activeRequests.push({
          id: req.req_id,
          title: req.Procedures?.title || "Unknown Request",
          date: req.created_at.toISOString().split('T')[0],
          status: status,
          currentLevel: data.current_level || 1,
        });
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: "Dashboard data fetched",
      data: {
        stats: { pending: pendingCount, approved: approvedCount, rejected: rejectedCount },
        activeRequests,
        notifications: [
          // Placeholder for now, can be implemented with a real notification system later
          { id: "1", title: "Welcome to SAMS", description: "Your dashboard is now live with real data.", time: "Just now", type: "info" }
        ]
      }
    };
  } catch (error: any) {
    console.error("getStudentDashboardData error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

