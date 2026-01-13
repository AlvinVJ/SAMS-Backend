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
    user: {uid: string, email: string, role: string, mits_uid: string}
    body: any;
}

// export async function fetch_roles(
//   payload: BasicPayload
// ): Promise<BasicResult> {
//   try {
//     console.log(payload.body.search);
//     const search = payload.body.search ?? "";

//     const roles = await prisma.roles.findMany({
//       where: {
//         is_active: true,
//         OR: [
//           {
//             role_tag: {
//               contains: search,
//               mode: "insensitive",
//             },
//           },
//           {
//             role_desc: {
//               contains: search,
//               mode: "insensitive",
//             },
//           },
//         ],
//       },
//       select: {
//         role_id: true,
//         role_tag: true,
//         role_desc: true,
//       },
//       orderBy: {
//         role_tag: "asc",
//       },
//       take: 10, // good for autocomplete
//     });

//     return {
//       success: true,
//       statusCode: 200,
//       message: "Roles fetched successfully",
//       data: {
//         roles,
//       },
//     };
//   } catch (error) {
//     console.error("fetch_roles service error:", error);

//     return {
//       success: false,
//       statusCode: 500,
//       message: "Internal server error",
//     };
//   }
// }


export async function fetch_roles(
  payload: BasicPayload
): Promise<BasicResult> {
  try {
    return {
      success: true,
      statusCode: 200,
      message: "success",
      data: [
        { id: "1", name: "Principal" },
        { id: "2", name: "Vice Principal" },
        { id: "3", name: "Class Advisor" },
        { id: "4", name: "Head of Department" },
        { id: "5", name: "Faculty" },
      ],
    };
  } catch (error) {
    console.error("fetch_roles service error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}
