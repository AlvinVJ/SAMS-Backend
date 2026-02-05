import { prisma } from "../db/prisma.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import admin from "../config/firebase.js";

interface Result {
    success: boolean;
    statusCode: number;
    message: string;
    data?: any;
}

interface inputPayload {
  headers: {
    authorization?: string | undefined;
  };
  body: {
    procedure?: any;
    requestId?: string;
    role?: string;
    comments?: string;
    reason?: string;
  };
  user: any;
}

async function resolveApproversForRole(
  roleTag: string,
  requesterUid: string
): Promise<string[]> {
  console.log(roleTag, requesterUid);
  if (roleTag === "class_advisor") {
    const student = await prisma.student.findUnique({
      where: { mits_uid: requesterUid },
      select: { class_id: true },
    });

    if (!student) return [];

    const advisors = await prisma.classFaculty.findMany({
      where: {
        class_id: student.class_id,
        role_tag: "class_advisor",
        is_active: true,
        deleted_at: null,
      },
      select: { mits_uid: true },
    });

    return advisors.map(a => a.mits_uid);
  }

  const role = await prisma.roles.findUnique({
    where: { role_tag: roleTag },
    select: { role_id: true },
  });

  if (!role) return [];

  const mappings = await prisma.roleMapping.findMany({
    where: {
      role_id: role.role_id,
      is_active: true,
      deleted_at: null,
    },
    select: { mits_uid: true },
  });

  return mappings.map(m => m.mits_uid);
}

export async function getRequestsToApproveService(
  payload: inputPayload
) {
  try {
    const { mits_uid, role } = payload.user;

    /* ---------------------------------- */
    /* 1️⃣ Authorization check            */
    /* ---------------------------------- */
    if (role !== "faculty" && role !== "admin") {
      return {
        success: false,
        statusCode: 403,
        message: "Not authorized to approve requests",
      };
    }

    /* ---------------------------------- */
    /* 2️⃣ Fetch pending requests (SQL)   */
    /* ---------------------------------- */
    const pendingRequests = await prisma.requests.findMany({
      where: {
        status: 0, // PENDING
      },
      include: {
        Procedures: {
          select: {
            title: true,
          },
        },
      },
    });

    const approvableRequests: any[] = [];

    /* ---------------------------------- */
    /* 3️⃣ Walk each request (Firebase)   */
    /* ---------------------------------- */
    for (const req of pendingRequests) {
      const snap = await firestore
        .collection("requests")
        .doc(req.req_id)
        .get();

      if (!snap.exists) continue;

      const data = snap.data();
      if (!data) continue;

      const currentLevel: number = data.current_level;

      const levelBlock = data.approval_progress?.find(
        (lvl: any) => lvl.level === currentLevel
      );

      if (!levelBlock) continue;

      /* ---------------------------------- */
      /* 4️⃣ State-based eligibility check  */
      /* ---------------------------------- */

      // level must still need approvals
      // 1️⃣ Level must still be active
      if (levelBlock.net_status !== "PENDING") continue;

      // 2️⃣ Find user's slot
      const myDecisionEntry = levelBlock.decisions.find(
        (d: any) => d.mits_uid === mits_uid
      );

      // 3️⃣ User must be an intended approver
      if (!myDecisionEntry) continue;

      // 4️⃣ User must not have already acted
      if (myDecisionEntry.decision) continue;

      // 5️⃣ Level must still need approvals
      const approvalsDone = levelBlock.decisions.filter(
        (d: any) => d.decision
      ).length;

      if (approvalsDone >= levelBlock.required_approvals) continue;

      
      /* ---------------------------------- */
      /* 5️⃣ Collect response               */
      /* ---------------------------------- */
      approvableRequests.push({
        request_id: req.req_id,
        procedure_title: req.Procedures.title,
        created_by: req.created_by,
        current_level: currentLevel,
      });
    }

    /* ---------------------------------- */
    /* 6️⃣ Return result                  */
    /* ---------------------------------- */
    return {
      success: true,
      statusCode: 200,
      message: "Pending approval requests fetched",
      data: {
        requests: approvableRequests,
      },
    };
  } catch (error) {
    console.error("getRequestsToApproveService error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function approveRequestService(payload: inputPayload): Promise<Result> {
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
      return { success: false, statusCode: 403, message: "You are not an authorized approver for this level" };
    }

    if (myDecision.decision) {
      return { success: false, statusCode: 400, message: "You have already acted on this request" };
    }

    // Update individual decision
    myDecision.decision = "APPROVED";
    myDecision.timestamp = new Date().toISOString();
    myDecision.comments = comments || null;

    // Check if level requirement is met
    const approvalsDone = levelBlock.decisions.filter((d: any) => d.decision === "APPROVED").length;

    if (approvalsDone >= levelBlock.required_approvals) {
      levelBlock.net_status = "APPROVED";

      // Check for next level advancement
      const procSnap = await firestore.collection("procedures").doc(data.procedure_id).get();
      const procedure = procSnap.data();
      const nextLevelNum = currentLevel + 1;
      const nextLevelDef = procedure?.approvalLevels?.find((l: any) => l.level === nextLevelNum);

      if (nextLevelDef) {
        // Advance to next level
        data.current_level = nextLevelNum;

        // Resolve approvers for next level
        let nextApprovers: string[] = [];
        for (const roleTag of nextLevelDef.roleIds || []) {
          const uids = await resolveApproversForRole(roleTag, data.created_by);
          nextApprovers.push(...uids);
        }
        nextApprovers = [...new Set(nextApprovers)];

        approvalProgress.push({
          level: nextLevelNum,
          net_status: "PENDING",
          required_approvals: nextLevelDef.allMustApprove ? nextApprovers.length : nextLevelDef.minApprovals,
          decisions: nextApprovers.map(uid => ({ mits_uid: uid }))
        });
      } else {
        // Final approval
        data.status = "APPROVED";
        await prisma.requests.update({
          where: { req_id: requestId },
          data: { status: 1 } // 1 = APPROVED
        });
      }
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      current_level: data.current_level,
      status: data.status,
      last_updated_at: new Date().toISOString()
    });

    return { success: true, statusCode: 200, message: "Request approved successfully" };
  } catch (error) {
    console.error("approveRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function rejectRequestService(payload: inputPayload): Promise<Result> {
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

    const data = snap.data()!;
    const approvalProgress = data.approval_progress || [];
    const currentLevel = data.current_level;

    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    if (!levelBlock) {
      return { success: false, statusCode: 400, message: "Level not found" };
    }

    const myDecision = levelBlock.decisions.find((d: any) => d.mits_uid === mits_uid);
    if (!myDecision) {
      return { success: false, statusCode: 403, message: "You are not an authorized approver for this level" };
    }

    // Update Firestore to REJECTED
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

    // Update SQL to REJECTED
    await prisma.requests.update({
      where: { req_id: requestId },
      data: { status: 2 } // 2 = REJECTED
    });

    return { success: true, statusCode: 200, message: "Request rejected successfully" };
  } catch (error) {
    console.error("rejectRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}