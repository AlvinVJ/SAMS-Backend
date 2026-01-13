import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import {firebaseAuth, firestore} from "../config/firebase.js";


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
    user: {uid: string, email: string, role: string, mits_uid: string}
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
        if (emailPrefix==null){
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

        const existingUser = await prisma.userAccount.findUnique({
            where: { mits_uid: emailPrefix },
        });

        if (!existingUser) {
            let userType: number | null;
            let role = payload.user.role;

            if (role === "admin") userType = 2;
            else if (role === "faculty") userType = 1;
            else if (role === "student") userType = 0; // student
            else userType = null;


            if(userType==null) {
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
            return {
                success: true,
                statusCode: 200,
                message: "User already exists",
                data: {
                    uid: payload.user.uid,
                    email: payload.user.email,
                    role: role,
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
    let role_snap = await prisma.userAccount.findUnique({
        where: {
            mits_uid: mits_uid,
        },
        select: {
            user_type: true,
        }
    });

    const role_id = role_snap?.user_type;

    // 1. Fetch procedures visible to this user_type
    const procedures = await prisma.procedures.findMany({
      where: {
        is_active: true,
        ProcedureVisibility: {
          some: {
            user_type: role_id,
          },
        },
      },
      select: {
        proc_id: true,
        title: true,
        desc_first_50_char: true,
      },
      orderBy: {
        title: "asc",
      },
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

    const user = await prisma.userAccount.findUnique({
      where: { mits_uid },
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

      form_response: formData,

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


