import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { processPlacementAttendance } from "./placement.service.js";
import { processHostellerNotification } from "./hostel.service.js";
import { publishApprovalAlert } from "../queues/producers/importantProducer.js";





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
    const isStudent = isStudentEmail(payload.user.email);
    let emailPrefix = payload.user.email.split("@")[0];

    if (emailPrefix == null) {
      return {
        success: false,
        statusCode: 400,
        message: "Invalid email format",
      };
    }

    console.log("Processing signup for:", emailPrefix);

    // 1️⃣ Check if user already has an account
    const existingAccount = await prisma.userAccount.findUnique({
      where: { mits_uid: emailPrefix },
      include: { UserTypes: true }
    });

    if (existingAccount) {
      console.log("Existing account found for:", emailPrefix);

      // Update linked Firebase UID or email if they've changed
      if (existingAccount.auth_uid !== payload.user.uid || existingAccount.email !== payload.user.email) {
        await prisma.userAccount.update({
          where: { mits_uid: emailPrefix },
          data: {
            auth_uid: payload.user.uid,
            email: payload.user.email
          }
        });
      }

      const role = existingAccount.UserTypes.user_type_tag.toLowerCase() === 'admin' ? 'admin'
        : existingAccount.UserTypes.user_type_tag.toLowerCase() === 'faculty' ? 'faculty'
          : 'student';

      return {
        success: true,
        statusCode: 200,
        message: "User already exists",
        data: {
          uid: payload.user.uid,
          email: payload.user.email,
          role: role,
          mits_uid: existingAccount.mits_uid,
          isActive: existingAccount.is_active,
          banned: existingAccount.isBanned || false,
          // Fetch additional profile info
          ...(role === 'student' ? {
            isHosteler: (await prisma.student.findUnique({ where: { mits_uid: existingAccount.mits_uid } }))?.hosteller || false,
          } : {})
        },
      };
    }

    // 2️⃣ Authorization Check: Must exist in Student or Faculty table to be "whitelisted"
    const studentProfile = await prisma.student.findUnique({
      where: { mits_uid: emailPrefix },
      include: { Classes: true, Batches: true }
    });
    const facultyProfile = await prisma.faculty.findUnique({
      where: { mits_uid: emailPrefix },
      include: { Departments: true }
    });

    const profile = studentProfile || facultyProfile;

    if (!profile) {
      console.log("User not pre-imported:", emailPrefix);
      return {
        success: false,
        statusCode: 403,
        message: "User not whitelisted in system",
      };
    }

    // Check if profile is active
    if (!profile.is_active || profile.deleted_at !== null) {
      return {
        success: false,
        statusCode: 403,
        message: "Your profile has been deactivated. Please contact administrator.",
      };
    }

    // 3️⃣ Determine User Type
    const userTypeTag = isStudent ? "STUDENT" : (facultyProfile ? "FACULTY" : "unknown");
    const userType = await prisma.userTypes.findUnique({ where: { user_type_tag: userTypeTag } });

    if (!userType) {
      return {
        success: false,
        statusCode: 500,
        message: "System configuration error: user type not found",
      };
    }

    // 4️⃣ Create User Account
    console.log(`Creating new ${userTypeTag} account for:`, emailPrefix);
    const newAccount = await prisma.userAccount.create({
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
        role: userTypeTag.toLowerCase(),
        mits_uid: emailPrefix,
        isActive: true,
        banned: false,
        isHosteler: studentProfile?.hosteller || false,
      },
    };

  } catch (error) {
    console.error("Signup service error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "An internal error occurred during signup",
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

export async function saveFCMToken(payload: BasicPayload): Promise<BasicResult> {
  try {
    const { mits_uid } = payload.user;
    const { fcm_token } = payload.body;

    // We optionally take session_id from client, or fallback to an auto-generated one if missing
    // Since Firebase Web SDK doesn't natively expose a session ID, we can use the token itself as the session ID mapping,
    // or just let the client send a unique device identifier.
    // For simplicity, we define session_id as a composite of mits_uid + last 8 chars of token if not provided.
    const session_id = payload.body.session_id || fcm_token.slice(-8);

    if (!fcm_token) {
      return {
        success: false,
        statusCode: 400,
        message: "fcm_token is required",
      };
    }

    // Upsert the token for this session
    await prisma.fCMTokens.upsert({
      where: {
        mits_uid_session_id: {
          mits_uid,
          session_id,
        },
      },
      update: {
        fcm_token,
        created_at: new Date(),
      },
      create: {
        mits_uid,
        session_id,
        fcm_token,
      },
    });

    return {
      success: true,
      statusCode: 200,
      message: "FCM token saved successfully",
    };
  } catch (error) {
    console.error("saveFCMToken service error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function deleteFCMToken(payload: BasicPayload): Promise<BasicResult> {
  try {
    const { mits_uid } = payload.user;
    const { session_id } = payload.body;

    if (!session_id) {
      return {
        success: false,
        statusCode: 400,
        message: "session_id is required",
      };
    }

    // Delete the token for this specific session/device
    await prisma.fCMTokens.deleteMany({
      where: {
        mits_uid: mits_uid,
        session_id: session_id,
      },
    });

    return {
      success: true,
      statusCode: 200,
      message: "FCM token deleted successfully",
    };
  } catch (error) {
    console.error("deleteFCMToken service error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}