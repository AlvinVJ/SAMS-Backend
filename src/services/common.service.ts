import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import {firebaseAuth, firestore} from "../config/firebase.js";


interface BasicResult {
    success: boolean;
    statusCode: number;
    message: string;
    data?: any;

}
interface BasicPayload {
    // headers: {
    //     authorization?: string | undefined;
    // };
    user: {uid: string, email: string, role: string}
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

// export async function fetch_procedures(
//   payload: BasicPayload
// ): Promise<BasicResult> {
//   try {
//     return {
//       success: true,
//       statusCode: 200,
//       message: `sucessfully fetched procedures for ${payload.user.uid}`,
//       data: {
//         procedures: [
//           ["adl4w2EtqTwzcIEBUS1r", "Leave Application", "Apply for academic leave"],
//           ["PROC_002", "Hostel Outpass", "Request permission to leave hostel"],
//           ["PROC_003", "Bonafide Certificate", "Generate bonafide certificate"],
//         ],
//       },
//     };
//   } catch (error) {
//     console.error("fetch_procedures error:", error);

//     return {
//       success: false,
//       statusCode: 500,
//       message: "Internal server error",
//     };
//   }
// }


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


