import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { processPlacementAttendance } from "./placement.service.js";


async function resolveApproversForRole(
  roleTag: string,
  requesterUid: string
): Promise<string[]> {
  console.log(`Resolving approvers for role: ${roleTag}, requester: ${requesterUid}`);
  const normalizedTag = roleTag.toLowerCase().trim();

  // -------------------------------------------------------------
  // 1. CLASS ADVISOR (Class-based role)
  // -------------------------------------------------------------
  if (normalizedTag === "class_advisor") {
    const student = await prisma.student.findUnique({
      where: { mits_uid: requesterUid },
      select: { class_id: true },
    });

    if (!student || !student.class_id) return [];

    const advisors = await prisma.classFaculty.findMany({
      where: {
        class_id: student.class_id,
        role_tag: { equals: "class_advisor", mode: 'insensitive' }, // Case-insensitive fix
        is_active: true,
        deleted_at: null,
      },
      select: { mits_uid: true },
    });

    return advisors.map(a => a.mits_uid);
  }

  // -------------------------------------------------------------
  // 2. HOD / ASSISTANT HOD (Department-based + Global Role)
  // -------------------------------------------------------------
  if (normalizedTag === "hod" || normalizedTag === "assistant_hod") {
    // A. FIND REQUESTER'S DEPARTMENT
    let deptId: number | null = null;

    // Check if student
    const student = await prisma.student.findUnique({
      where: { mits_uid: requesterUid },
      include: { Classes: true }
    });

    if (student && student.Classes) {
      deptId = student.Classes.dept_id;
    } else {
      // Check if faculty
      const faculty = await prisma.faculty.findUnique({
        where: { mits_uid: requesterUid },
        select: { department_id: true }
      });
      if (faculty) {
        deptId = faculty.department_id;
      }
    }

    if (!deptId) {
      console.warn(`Could not determine department for requester ${requesterUid}, cannot resolve ${roleTag}`);
      return [];
    }

    // B. FIND USERS WITH THIS GLOBAL ROLE
    const role = await prisma.roles.findFirst({
      where: { role_tag: { equals: normalizedTag, mode: 'insensitive' } },
      select: { role_id: true },
    });

    if (!role) return [];

    const potentialApprovers = await prisma.roleMapping.findMany({
      where: {
        role_id: role.role_id,
        is_active: true,
        deleted_at: null,
      },
      include: {
        UserAccount: {
          include: {
            Faculty: true // We need this to check THEIR department
          }
        }
      }
    });

    // C. FILTER BY SAME DEPARTMENT
    // The approver must belong to the SAME department as the requester
    const departmentApprovers = potentialApprovers.filter(mapping => {
      return mapping.UserAccount?.Faculty?.department_id === deptId;
    });

    return departmentApprovers.map(m => m.mits_uid);
  }

  // -------------------------------------------------------------
  // 3. GENERIC GLOBAL ROLES (Principal, etc.)
  // -------------------------------------------------------------
  const role = await prisma.roles.findFirst({
    where: { role_tag: { equals: normalizedTag, mode: 'insensitive' } },
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

async function buildInitialApprovalProgress(
  procedureId: string,
  requesterUid: string
) {
  /* 1️⃣ Fetch procedure definition */
  const procSnap = await admin
    .firestore()
    .collection("procedures")
    .doc(procedureId)
    .get();

  if (!procSnap.exists) {
    throw new Error("Procedure definition not found");
  }

  const procedure = procSnap.data();
  console.log(procedure);
  const approvalLevels = procedure?.approvalLevels ?? [];

  if (approvalLevels.length === 0) {
    return []; // no approval workflow
  }

  const firstLevel = approvalLevels[0];
  let approvers: string[] = [];

  /* 2️⃣ Resolve approvers from roles */
  for (const roleTag of firstLevel.roleIds ?? []) {
    const users = await resolveApproversForRole(roleTag, requesterUid);
    console.log(users);
    approvers.push(...users);
  }

  approvers = [...new Set(approvers)]; // de-dup

  /* 3️⃣ Build seeded decisions */
  const decisions = approvers.map(uid => ({
    mits_uid: uid,
  }));

  /* 4️⃣ Return approval_progress array */
  return [
    {
      level: 1,
      net_status: "PENDING",
      required_approvals: firstLevel.allMustApprove
        ? approvers.length
        : firstLevel.minApprovals,
      decisions,
    },
  ];
}


interface BasicResult {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;

}
interface BasicPayload {
  user: { uid: string, email: string, role: string, mits_uid: string }
  body: any;
}

function isStudentEmail(email: string): boolean {
  const studentRegex = /^[0-9]+[a-zA-Z]+[0-9]+@mgits\.ac\.in$/;
  return studentRegex.test(email);
}

export async function signup(payload: BasicPayload): Promise<BasicResult> {
  try {
    const db = firestore;
    const isStudent = isStudentEmail(payload.user.email);

    let role: "student" | "faculty" | "admin";
    let emailPrefix = payload.user.email.split("@")[0];
    if (emailPrefix == null) {
      return {
        success: false,
        statusCode: 404,
        message: "email not found",
      };
    }

    if (isStudent) {
      role = "student";
    } else {
      const userDetailsSnap = await db
        .collection("userDetails")
        .doc(emailPrefix)
        .get();

      if (!userDetailsSnap.exists) {
        return {
          success: false,
          statusCode: 403,
          message: "User not authorized to sign up",
        };
      }

      const userData = userDetailsSnap.data()!;
      role = userData.role;
    }


    const profileRef = db.collection("profiles").doc(emailPrefix);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      await profileRef.set({
        banned: false,
        email: payload.user.email,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        role: role,
        uid: emailPrefix.toUpperCase()
      });
    }

    console.log("Signup prefix:", emailPrefix);
    const existingUser = await prisma.userAccount.findUnique({
      where: { mits_uid: emailPrefix },
    });

    if (!existingUser) {
      console.log("Creating new UserAccount for:", emailPrefix);
      let userType: number | null;
      let role = payload.user.role;

      if (role === "admin") userType = 2;
      else if (role === "faculty") userType = 1;
      else if (role === "student") userType = 0; // student
      else userType = null;


      if (userType == null) {
        return {
          success: false,
          statusCode: 403,
          message: "invalid credentials initialized in whitelist table",
        };
      }
      await prisma.userAccount.create({
        data: {
          auth_uid: payload.user.uid,
          mits_uid: emailPrefix,
          email: payload.user.email,
          user_type: userType
        },
      });
      return {
        success: true,
        statusCode: 201,
        message: "User signed up successfully",
        data: {
          uid: payload.user.uid,
          email: payload.user.email,
          role: role,
        },
      };
    }
    else {
      console.log("Existing user found. Current email:", existingUser.email, "New email:", payload.user.email);
      if (existingUser.email !== payload.user.email) {
        console.log("Updating email for user:", emailPrefix);
        await prisma.userAccount.update({
          where: { mits_uid: emailPrefix },
          data: { email: payload.user.email },
        });
      }
      return {
        success: true,
        statusCode: 200,
        message: "User already exists",
        data: {
          uid: payload.user.uid,
          email: payload.user.email,
          role: payload.user.role,
        },
      };
    }
  } catch (error) {
    console.error("Signup service error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }

}

export async function fetch_procedures(
  payload: BasicPayload
): Promise<BasicResult> {
  try {
    const { mits_uid, role } = payload.user;
    // 1. Get primary user type
    let user_snap = await prisma.userAccount.findFirst({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' } },
      select: { user_type: true }
    });

    if (!user_snap) {
      return { success: false, statusCode: 403, message: "User not found" };
    }

    const visibleTypes = [user_snap.user_type];

    // 2. Fetch all roles assigned to this user (Global + Class-based)
    const roleTags = new Set<string>();

    const globalRoles = await prisma.roleMapping.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      include: { Roles: true }
    });
    globalRoles.forEach(r => roleTags.add(r.Roles.role_tag.toUpperCase()));

    const classRoles = await prisma.classFaculty.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      select: { role_tag: true }
    });
    classRoles.forEach(r => roleTags.add(r.role_tag.toUpperCase()));

    // 3. Map specific roles to virtual user types for visibility
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

    roleTags.forEach(tag => {
      const norm = normalize(tag);
      if (norm === 'CLUBLEAD') visibleTypes.push(3);
      if (norm === 'PLACEMENTCOORDINATOR' || norm === 'PLACEMENTCOORD') {
        if (!visibleTypes.includes(4)) visibleTypes.push(4);
      }
    });

    // 4. Fetch procedures visible to any of these types
    let allActiveProcs = await prisma.procedures.findMany({
      where: { is_active: true },
      include: { ProcedureVisibility: true }
    });

    // AUTO-REPAIR: If any active procedure has NO visibility, fix it now (one-time safety)
    const proceduresToRepair = allActiveProcs.filter(p => p.ProcedureVisibility.length === 0);
    if (proceduresToRepair.length > 0) {
      for (const p of proceduresToRepair) {
        const fallbackTypes = p.title.includes("Placement") ? [4, 1] : [1];
        await prisma.procedureVisibility.createMany({
          data: fallbackTypes.map(t => ({ proc_id: p.proc_id, user_type: t }))
        });
      }
      allActiveProcs = await prisma.procedures.findMany({
        where: { is_active: true },
        include: { ProcedureVisibility: true }
      });
    }

    const procedures = allActiveProcs.filter(p =>
      p.ProcedureVisibility.some(v => visibleTypes.includes(v.user_type))
    );

    return {
      success: true,
      statusCode: 200,
      message: `Successfully fetched procedures for user ${mits_uid}`,
      data: {
        procedures: procedures.map(p => [
          p.proc_id,
          p.title,
          p.desc_first_50_char,
        ]),
      },
    };
  } catch (error) {
    console.error("fetch_procedures error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function create_request(
  payload: BasicPayload
): Promise<BasicResult> {
  try {
    const { mits_uid } = payload.user;
    const { procedureId, formData } = payload.body;

    if (!procedureId || !formData) {
      return {
        success: false,
        statusCode: 400,
        message: "procedureId and formData are required",
      };
    }

    const user = await prisma.userAccount.findFirst({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' } },
      select: { user_type: true },
    });

    if (!user) {
      return {
        success: false,
        statusCode: 403,
        message: "User not registered",
      };
    }

    const procedure = await prisma.procedures.findFirst({
      where: {
        proc_id: procedureId,
        is_active: true,
        ProcedureVisibility: {
          some: {
            user_type: user.user_type,
          },
        },
      },
    });

    if (!procedure) {
      return {
        success: false,
        statusCode: 403,
        message: "Procedure not accessible",
      };
    }

    // ---------------------------------------------------------
    // SYSTEM HOOK INTERCEPTION (Special Workflows)
    // ---------------------------------------------------------
    const procDoc = await firestore.collection("procedures").doc(procedureId).get();
    const procData = procDoc.data();

    if (procData?.system_hook === "PLACEMENT_BULK") {
      // Find the student list in formData (it could be named 'student_list' or something like 'upload_student_list_csv')
      const studentListData = formData.student_list ||
        formData.upload_student_list_csv ||
        Object.entries(formData).find(([k]) => k.includes('student_list'))?.[1] || [];

      return await processPlacementAttendance({
        procedureId: procedureId,
        students: studentListData,
        coordinatorUid: mits_uid,
        eventName: formData.event_name || formData.title || formData.event_name_ || Object.entries(formData).find(([k]) => k.includes('event_name'))?.[1] || "Placement Event",
        date: formData.event_date || formData.event_data || formData.date || new Date().toISOString().split('T')[0],
      });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const approval_progress = await buildInitialApprovalProgress(
      procedureId,
      mits_uid
    );


    const requestDoc = {
      procedure_id: procedureId,
      created_by: mits_uid,
      created_at: now,
      last_updated_at: now,

      status: "PENDING",
      current_level: 1,
      priority: "NORMAL",

      //do context mapping
      context: {
        department_id: null,
        class_id: null,
        club_id: null,
      },

      formData,

      approval_progress, // initialized empty; filled later
    };

    const reqRef = await admin
      .firestore()
      .collection("requests")
      .add(requestDoc);

    const req_id = reqRef.id; // 🔑 Firestore doc id

    await prisma.requests.create({
      data: {
        req_id,
        proc_id: procedureId,
        created_by: mits_uid,
        status: 0, // PENDING
      },
    });


    return {
      success: true,
      statusCode: 201,
      message: "Request created successfully",
      data: {
        request_id: req_id,
        procedure_id: procedureId,
        status: "PENDING",
      },
    };
  } catch (error) {
    console.error("create_request error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function getRoleTags(
  payload: BasicPayload
) {
  try {
    const { mits_uid } = payload.user;

    /* ---------------------------------- */
    /* 1️⃣ Global roles (RoleMapping)     */
    /* ---------------------------------- */
    const globalRoles = await prisma.roleMapping.findMany({
      where: {
        mits_uid: { equals: mits_uid, mode: 'insensitive' },
        is_active: true,
        deleted_at: null,
      },
      include: {
        Roles: {
          select: {
            role_tag: true,
          },
        },
      },
    });

    /* ---------------------------------- */
    /* 2️⃣ Class-based roles              */
    /* ---------------------------------- */
    const classRoles = await prisma.classFaculty.findMany({
      where: {
        mits_uid: { equals: mits_uid, mode: 'insensitive' },
        is_active: true,
        deleted_at: null,
      },
      select: {
        role_tag: true,
      },
    });

    /* ---------------------------------- */
    /* 3️⃣ Merge + dedupe                 */
    /* ---------------------------------- */
    const roleTags = new Set<string>();

    globalRoles.forEach(r => roleTags.add(r.Roles.role_tag));
    classRoles.forEach(r => roleTags.add(r.role_tag));

    /* ---------------------------------- */
    /* 5️⃣ Return result                  */
    /* ---------------------------------- */
    return {
      success: true,
      statusCode: 200,
      message: "Fetched your role tags",
      data: {
        role_tags: Array.from(roleTags),
      },
    };
  } catch (error) {
    console.error("getMyRoleTagsService error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}