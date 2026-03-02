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
      mode: "insensitive" as const,
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

    // 2️⃣ From ClubAdmin → RoleMapping → Roles
    const clubAdmins = await prisma.clubAdmin.findMany({
      where: {
        is_active: true,
        RoleMapping: {
          is_active: true,
          Roles: {
            role_tag: roleFilter,
          },
        },
      },
      select: {
        RoleMapping: {
          select: {
            Roles: {
              select: {
                role_tag: true,
              },
            },
          },
        },
      },
    });

    // 3️⃣ From Clubs (coordinator role) → RoleMapping → Roles
    const clubs = await prisma.clubs.findMany({
      where: {
        is_active: true,
        RoleMapping: {
          is_active: true,
          Roles: {
            role_tag: roleFilter,
          },
        },
      },
      select: {
        RoleMapping: {
          select: {
            Roles: {
              select: {
                role_tag: true,
              },
            },
          },
        },
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

    // 🔹 Normalize + deduplicate by role_tag
    const uniqueRoleTags = new Set<string>();

    classFaculty.forEach(r => r.role_tag && uniqueRoleTags.add(r.role_tag.toUpperCase()));
    clubAdmins.forEach(r => r.RoleMapping?.Roles.role_tag && uniqueRoleTags.add(r.RoleMapping.Roles.role_tag.toUpperCase()));
    clubs.forEach(r => r.RoleMapping?.Roles.role_tag && uniqueRoleTags.add(r.RoleMapping.Roles.role_tag.toUpperCase()));
    roles.forEach(r => r.role_tag && uniqueRoleTags.add(r.role_tag.toUpperCase()));

    const data = Array.from(uniqueRoleTags).map(tag => ({
      mits_uid: "ROLE", // Indicate this is an abstract role
      name: "Contextual Role Holder",
      role_tag: tag,
    }));

    return {
      success: true,
      statusCode: 200,
      message: "success",
      data,
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
