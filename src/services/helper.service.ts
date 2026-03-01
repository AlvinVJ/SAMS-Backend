import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import { firebaseAuth, firestore } from "../config/firebase.js";

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


// export async function fetch_roles(
//   payload: BasicPayload
// ): Promise<BasicResult> {
//   try {
//     console.log(payload);
//     return {
//       success: true,
//       statusCode: 200,
//       message: "success",
//       data: [
//         { id: "1", name: "Principal" },
//         { id: "2", name: "Vice Principal" },
//         { id: "3", name: "Class Advisor" },
//         { id: "4", name: "Head of Department" },
//         { id: "5", name: "Faculty" },
//       ],
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
    const search = payload.body?.search ?? "";

    if (!search) {
      return {
        success: true,
        statusCode: 200,
        message: "success",
        data: [],
      };
    }

    const roleFilter = {
      contains: search,
      //mode: "insensitive" as const,
    };

    // 1️⃣ From ClassFaculty
    const classFaculty = await prisma.classFaculty.findMany({
      where: {
        role_tag: roleFilter,
        is_active: true,
      },
      select: {
        role_tag: true,
        Faculty: {
          select: {
            mits_uid: true,
            name: true,
          },
        },
      },
    });

    // 2️⃣ From ClubAdmin → Roles (no user directly, skip user mapping)
    const clubAdmins = await prisma.clubAdmin.findMany({
      where: {
        role_tag: roleFilter,
        is_active: true,
      },
      select: {
        role_tag: true,
      },
    });

    // 3️⃣ From Clubs (coordinator role)
    const clubs = await prisma.clubs.findMany({
      where: {
        coordinator_role_tag: roleFilter,
        is_active: true,
      },
      select: {
        coordinator_role_tag: true,
      },
    });

    // 4️⃣ From Roles → RoleMapping → Faculty
    const roles = await prisma.roles.findMany({
      where: {
        role_tag: roleFilter,
        is_active: true,
      },
      select: {
        role_tag: true,
        RoleMapping: {
          where: { is_active: true },
          select: {
            mits_uid: true,
          },
        },
      },
    });

    // 🔹 Normalize + deduplicate
    const resultMap = new Map<string, any>();

    classFaculty.forEach(r => {
      if (r.Faculty) {
        resultMap.set(
          `${r.Faculty.mits_uid}-${r.role_tag}`,
          {
            mits_uid: r.Faculty.mits_uid,
            name: r.Faculty.name,
            role_tag: r.role_tag,
          }
        );
      }
    });

    for (const r of roles) {
      for (const m of r.RoleMapping) {
        const faculty = await prisma.faculty.findUnique({
          where: { mits_uid: m.mits_uid },
          select: { name: true }
        });
        if (faculty) {
          resultMap.set(
            `${m.mits_uid}-${r.role_tag}`,
            {
              mits_uid: m.mits_uid,
              name: faculty.name,
              role_tag: r.role_tag,
            }
          );
        }
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: "success",
      data: Array.from(resultMap.values()),
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
