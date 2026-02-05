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
