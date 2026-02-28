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
  // 2. HOD / ASSISTANT HOD (Department-based Role)
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

    // B. FIND USERS IN THIS DEPARTMENT WITH THIS ROLE IN DepartmentFaculty table
    const approvers = await prisma.departmentFaculty.findMany({
      where: {
        dept_id: deptId,
        is_active: true,
        deleted_at: null,
        Roles: {
          role_tag: normalizedTag === 'assistant_hod'
            ? { in: ['ASSISTANT_HOD', 'ASST_HOD'], mode: 'insensitive' }
            : { equals: normalizedTag, mode: 'insensitive' }
        }
      },
      select: { mits_uid: true }
    });

    return approvers.map(a => a.mits_uid);
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
    return { approval_progress: [], initialApprovers: [], initialRole: null };
  }

  const firstLevel = approvalLevels[0];
  let approvers: string[] = [];

  /* 2️⃣ Resolve approvers from roles */
  // Handle both roleIds (array) and role (single string)
  const roleTags = firstLevel.roleIds ?? (firstLevel.role ? [firstLevel.role] : []);
  for (const roleTag of roleTags) {
    const users = await resolveApproversForRole(roleTag, requesterUid);
    approvers.push(...users);
  }

  approvers = [...new Set(approvers)]; // de-dup

  /* 3️⃣ Build seeded decisions */
  const decisions = approvers.map(uid => ({
    mits_uid: uid,
  }));

  const initialRole = roleTags[0] || "Approver";

  /* 4️⃣ Return approval_progress array and metadata */
  return {
    approval_progress: [
      {
        level: 1,
        net_status: "PENDING",
        required_approvals: firstLevel.allMustApprove
          ? approvers.length
          : firstLevel.minApprovals,
        decisions,
      },
    ],
    initialApprovers: approvers,
    initialRole
  };
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
      console.log("Checking for pre-imported profile for:", emailPrefix);

      // Look for profile in Student or Faculty tables
      const studentProfile = await prisma.student.findUnique({ where: { mits_uid: emailPrefix } });
      const facultyProfile = await prisma.faculty.findUnique({ where: { mits_uid: emailPrefix } });

      if (!studentProfile && !facultyProfile) {
        return {
          success: false,
          statusCode: 403,
          message: "User not found in system. Please contact administrator.",
        };
      }

      // Determine user type ID based on profile and Firestore role
      const userTypeTag = isStudent ? "STUDENT" : (role === "admin" ? "ADMIN" : "FACULTY");
      const userType = await prisma.userTypes.findUnique({ where: { user_type_tag: userTypeTag } });

      if (!userType) {
        return {
          success: false,
          statusCode: 500,
          message: "User type configuration error",
        };
      }

      console.log("Creating new UserAccount for:", emailPrefix);
      await prisma.userAccount.create({
        data: {
          auth_uid: payload.user.uid,
          mits_uid: emailPrefix,
          email: payload.user.email,
          user_type: userType.user_type_id
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
      // Link Google UID / update email if it was a temp pre-import account or email changed
      if (existingUser.email !== payload.user.email || existingUser.auth_uid !== payload.user.uid) {
        console.log("Updating account for user:", emailPrefix);
        await prisma.userAccount.update({
          where: { mits_uid: emailPrefix },
          data: {
            email: payload.user.email,
            auth_uid: payload.user.uid
          },
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
    const { mits_uid } = payload.user;

    // 1. Get user and their primary user type
    const user = await prisma.userAccount.findFirst({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' } },
      select: { user_type: true }
    });

    if (!user) {
      return { success: false, statusCode: 403, message: "User not found" };
    }

    const visibleTypes = new Set<number>();
    visibleTypes.add(user.user_type);

    // 2. Fetch all role tags assigned to this user
    const roleTags = new Set<string>();

    const globalRoles = await prisma.roleMapping.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      include: { Roles: true }
    });
    globalRoles.forEach(r => roleTags.add(r.Roles.role_tag));

    const classRoles = await prisma.classFaculty.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      select: { role_tag: true }
    });
    classRoles.forEach(r => roleTags.add(r.role_tag));

    // 3. Dynamic Mapping: Match role tags to UserTypes
    const userTypes = await prisma.userTypes.findMany({ where: { is_active: true } });
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const normRoleTags = Array.from(roleTags).map(t => normalize(t));

    userTypes.forEach(ut => {
      if (normRoleTags.includes(normalize(ut.user_type_tag))) {
        visibleTypes.add(ut.user_type_id);
      }
    });

    // 4. Fetch procedures with visibility records
    const procedures = await prisma.procedures.findMany({
      where: {
        is_active: true,
        ProcedureVisibility: {
          some: {
            user_type: { in: Array.from(visibleTypes) }
          }
        }
      },
      select: {
        proc_id: true,
        title: true,
        desc_first_50_char: true
      }
    });

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

    // 1. Resolve user and their roles
    const user_snap = await prisma.userAccount.findFirst({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' } },
      select: { user_type: true },
    });

    if (!user_snap) {
      return { success: false, statusCode: 403, message: "User not registered" };
    }

    const visibleTypes = new Set<number>();
    visibleTypes.add(user_snap.user_type);

    const roleTags = new Set<string>();
    const globalRoles = await prisma.roleMapping.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      include: { Roles: true }
    });
    globalRoles.forEach(r => roleTags.add(r.Roles.role_tag));

    const classRoles = await prisma.classFaculty.findMany({
      where: { mits_uid: { equals: mits_uid, mode: 'insensitive' }, is_active: true },
      select: { role_tag: true }
    });
    classRoles.forEach(r => roleTags.add(r.role_tag));

    const userTypes = await prisma.userTypes.findMany({ where: { is_active: true } });
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normRoleTags = Array.from(roleTags).map(t => normalize(t));

    userTypes.forEach(ut => {
      if (normRoleTags.includes(normalize(ut.user_type_tag))) {
        visibleTypes.add(ut.user_type_id);
      }
    });

    // 2. Check procedure accessibility
    const procedure = await prisma.procedures.findFirst({
      where: {
        proc_id: procedureId,
        is_active: true,
        ProcedureVisibility: {
          some: {
            user_type: { in: Array.from(visibleTypes) },
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
    const { approval_progress, initialApprovers, initialRole } = await buildInitialApprovalProgress(
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

      approval_progress,
    };

    const reqRef = await admin
      .firestore()
      .collection("requests")
      .add(requestDoc);

    const req_id = reqRef.id; // 🔑 Firestore doc id

    // 3. Create SQL Request record
    await prisma.requests.create({
      data: {
        req_id,
        proc_id: procedureId,
        created_by: mits_uid,
        status: 0, // PENDING
      },
    });

    // 4. Populate ToApprove table for initial level approvers
    if (initialApprovers.length > 0) {
      await prisma.toApprove.createMany({
        data: initialApprovers.map(uid => ({
          req_id: req_id,
          approverUID: uid,
          approvalLevel: 1,
          approvalType: initialRole || "Approver"
        })),
        skipDuplicates: true
      });

      // 5. Update Analytics pending count
      try {
        if (initialRole) {
          const roleRow = await prisma.roles.findFirst({
            where: { role_tag: { equals: initialRole, mode: 'insensitive' } }
          });
          if (roleRow) {
            for (const approverUid of initialApprovers) {
              await prisma.analytics.upsert({
                where: { mits_uid_role_id: { mits_uid: approverUid, role_id: roleRow.role_id } },
                create: { mits_uid: approverUid, role_id: roleRow.role_id, pending: 1, approved: 0, rejected: 0 },
                update: { pending: { increment: 1 } }
              });
            }
          }
        }
      } catch (e) {
        console.error("Analytics pending update failed:", e);
      }
    }


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

export async function searchFaculty(payload: BasicPayload): Promise<BasicResult> {
  try {
    const { query } = payload.body;
    if (!query || query.trim().length < 2) {
      return {
        success: true,
        statusCode: 200,
        message: "Search query too short",
        data: { faculty: [] }
      };
    }

    const faculty = await prisma.faculty.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { mits_uid: { contains: query, mode: "insensitive" } }
        ],
        is_active: true,
        deleted_at: null
      },
      select: {
        mits_uid: true,
        name: true,
        email: true,
        Departments: {
          select: { dept_name: true }
        }
      },
      take: 10
    });

    return {
      success: true,
      statusCode: 200,
      message: "Faculty search results",
      data: {
        faculty: faculty.map(f => ({
          uid: f.mits_uid,
          name: f.name,
          email: f.email,
          department: f.Departments?.dept_name || "N/A"
        }))
      }
    };
  } catch (error) {
    console.error("searchFaculty service error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}