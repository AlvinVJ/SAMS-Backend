import { prisma } from "../db/prisma.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import admin from "../config/firebase.js";
import { getUserNameFromUid, resolveRequestStatus } from "./requests.service.js";



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

// export async function getDashboardStats() {
//   const [users, requests] = await Promise.all([
//     prisma.user.count(),
//     prisma.batches.count(),
//   ]);

//   return {
//     totalUsers: users,
//     totalRequests: requests,
//   };
// }

export async function saveProcedureDef(payload: inputPayload): Promise<Result> {
  try {
    /* ---------------------------------- */
    /* 2️⃣ Validate request body           */
    /* ---------------------------------- */
    const { title, desc } = payload.body.procedure;

    if (!title || !desc) {
      return {
        success: false,
        statusCode: 400,
        message: "Procedure title and definition are required",
      };
    }

    /* ---------------------------------- */
    /* 3️⃣ Check if procedure exists (DB)  */
    /* ---------------------------------- */
    const existingProcedure = await prisma.procedures.findFirst({
      where: {
        title: title,
        is_active: true
      },
    });

    if (existingProcedure) {
      return {
        success: false,
        statusCode: 409,
        message: "Procedure already exists",
      };
    }

    /* ---------------------------------- */
    /* 4️⃣ Save procedure definition (FS)  */
    /* ---------------------------------- */
    const procRef = await firestore
      .collection("procedures")
      .add({
        ...payload.body.procedure,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    const firestoreDocId = procRef.id;
    console.log(payload);

    /* ---------------------------------- */
    /* 5️⃣ Save metadata to Azure DB       */
    /* ---------------------------------- */
    await prisma.procedures.create({
      data: {
        proc_id: firestoreDocId,
        title: title,
        desc_first_50_char: JSON.stringify(payload.body.procedure.desc).slice(0, 50),
        is_active: true,
        created_by: payload.user.mits_uid,
        deleted_at: null,
      },
    });

    const userTypes = await prisma.userTypes.findMany({
      where: { is_active: true },
    });

    const visibility: string[] = payload.body.procedure.visibility;
    if (!Array.isArray(visibility) || visibility.length === 0) {
      return {
        success: false,
        statusCode: 400,
        message: "Invalid visibility format",
      };
    }

    // "all" | "student" | "faculty" | "admin"

    let allowedUserTypes;

    if (visibility.includes("all")) {
      allowedUserTypes = userTypes;
    } else {
      const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const tags = visibility.map(v => normalize(v)); // e.g. ["PLACEMENTCOORDINATOR"]

      allowedUserTypes = userTypes.filter(
        (ut) => tags.includes(normalize(ut.user_type_tag))
      );
    }

    await prisma.procedureVisibility.createMany({
      data: allowedUserTypes.map((ut) => ({
        proc_id: firestoreDocId,
        user_type: ut.user_type_id,
      })),
    });


    /* ---------------------------------- */
    /* 6️⃣ Success                         */
    /* ---------------------------------- */
    return {
      success: true,
      statusCode: 201,
      message: "Procedure created successfully",
      data: {
        proc_id: firestoreDocId,
        title,
      },
    };
  } catch (error) {
    console.error("saveProcedureDef error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

// ============================================
// GET ALL PROCEDURES
// ============================================
export async function getProcedures(payload: { user: any }): Promise<Result> {
  try {
    // Fetch procedures from SQL (active and inactive)
    const procedures = await prisma.procedures.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        proc_id: 'desc', // Most recent first
      },
    });

    // For each procedure, fetch approval levels count from Firestore
    const proceduresWithDetails = await Promise.all(
      procedures.map(async (proc) => {
        try {
          const firestoreDoc = await firestore
            .collection("procedures")
            .doc(proc.proc_id)
            .get();

          const firestoreData = firestoreDoc.data();
          const approvalLevelsCount = firestoreData?.approvalLevels?.length || 0;

          return {
            proc_id: proc.proc_id,
            title: proc.title,
            description: proc.desc_first_50_char,
            approval_levels_count: approvalLevelsCount,
            created_by: proc.created_by,
            is_active: proc.is_active,
          };
        } catch (err) {
          console.error(`Error fetching Firestore data for ${proc.proc_id}:`, err);
          return {
            proc_id: proc.proc_id,
            title: proc.title,
            description: proc.desc_first_50_char,
            approval_levels_count: 0,
            created_by: proc.created_by,
            is_active: proc.is_active,
          };
        }
      })
    );

    return {
      success: true,
      statusCode: 200,
      message: "Procedures fetched successfully",
      data: {
        procedures: proceduresWithDetails,
      },
    };
  } catch (error) {
    console.error("getProcedures error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

// ============================================
// GET SINGLE PROCEDURE BY ID
// ============================================
// ============================================
// GET SINGLE PROCEDURE BY ID
// ============================================
export async function getProcedureById(payload: {
  procedureId: string;
  user: any;
}): Promise<Result> {
  try {
    const { procedureId } = payload;

    // Check if procedure exists in SQL
    const procedure = await prisma.procedures.findUnique({
      where: { proc_id: procedureId },
    });

    if (!procedure) {
      return {
        success: false,
        statusCode: 404,
        message: "Procedure not found",
      };
    }

    if (procedure.deleted_at) {
      return {
        success: false,
        statusCode: 404,
        message: "Procedure has been deleted",
      };
    }

    // Fetch full procedure from Firestore
    const firestoreDoc = await firestore
      .collection("procedures")
      .doc(procedureId)
      .get();

    if (!firestoreDoc.exists) {
      return {
        success: false,
        statusCode: 404,
        message: "Procedure definition not found",
      };
    }

    const firestoreData = firestoreDoc.data();

    // Fetch visibility settings (without include)
    const visibilityRecords = await prisma.procedureVisibility.findMany({
      where: { proc_id: procedureId },
    });

    // Fetch user types separately
    const userTypeIds = visibilityRecords.map(v => v.user_type);
    const userTypes = await prisma.userTypes.findMany({
      where: {
        user_type_id: { in: userTypeIds }
      }
    });

    const visibility = userTypes.map((ut) =>
      ut.user_type_tag.toLowerCase()
    );

    return {
      success: true,
      statusCode: 200,
      message: "Procedure fetched successfully",
      data: {
        procedure: {
          proc_id: procedureId,
          title: firestoreData?.title || procedure.title,
          description: firestoreData?.desc || "",
          formFields: firestoreData?.formFields || [],
          approvalLevels: firestoreData?.approvalLevels || [],
          visibility: visibility,
          is_hosteller: firestoreData?.is_hosteller || firestoreData?.isHosteller || false,
          system_hook: firestoreData?.system_hook || firestoreData?.systemHook || null,
        },
      },
    };
  } catch (error) {
    console.error("getProcedureById error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}
// ============================================
// UPDATE PROCEDURE
// ============================================
export async function updateProcedure(payload: {
  procedureId: string;
  body: any;
  user: any;
}): Promise<Result> {
  try {
    const { procedureId, body } = payload;
    const { title, desc, formFields, approvalLevels, visibility, system_hook, is_hosteller } = body.procedure;

    // Check if procedure exists
    const existingProcedure = await prisma.procedures.findUnique({
      where: { proc_id: procedureId },
    });

    if (!existingProcedure) {
      return {
        success: false,
        statusCode: 404,
        message: "Procedure not found",
      };
    }

    if (!existingProcedure.is_active || existingProcedure.deleted_at) {
      return {
        success: false,
        statusCode: 400,
        message: "Cannot update deleted procedure",
      };
    }

    // -------------------------------------------------------------------------
    // VERSIONING LOGIC:
    // Instead of updating the existing record, we deactivate it and create a new one.
    // -------------------------------------------------------------------------

    // 1. Deactivate old procedure in SQL
    await prisma.procedures.update({
      where: { proc_id: procedureId },
      data: {
        is_active: false,
        // We don't set deleted_at because it's just an old version, not "deleted"
      },
    });

    // 2. Deactivate old procedure in Firestore
    await firestore
      .collection("procedures")
      .doc(procedureId)
      .update({
        is_active: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // 3. Create NEW Firestore doc for the new version
    const newProcRef = await firestore
      .collection("procedures")
      .add({
        title,
        desc,
        formFields,
        approvalLevels,
        visibility,
        system_hook,
        is_hosteller: is_hosteller || false,
        is_active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        previousVersionId: procedureId, // Optional: track history
      });

    const newFirestoreDocId = newProcRef.id;

    // 4. Create NEW SQL metadata record
    await prisma.procedures.create({
      data: {
        proc_id: newFirestoreDocId,
        title: title,
        desc_first_50_char: JSON.stringify(desc).slice(0, 50),
        is_active: true,
        created_by: payload.user.mits_uid,
      },
    });

    // 5. Create visibility records for the new version
    const userTypes = await prisma.userTypes.findMany({
      where: { is_active: true },
    });

    let allowedUserTypes;
    if (visibility.includes("all")) {
      allowedUserTypes = userTypes;
    } else {
      const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const tags = visibility.map((v: string) => normalize(v));
      allowedUserTypes = userTypes.filter((ut) =>
        tags.includes(normalize(ut.user_type_tag))
      );
    }

    await prisma.procedureVisibility.createMany({
      data: allowedUserTypes.map((ut) => ({
        proc_id: newFirestoreDocId,
        user_type: ut.user_type_id,
      })),
    });

    return {
      success: true,
      statusCode: 200,
      message: "Procedure versioned successfully",
      data: {
        proc_id: newFirestoreDocId,
      },
    };
  } catch (error) {
    console.error("updateProcedure error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

// ============================================
// DELETE PROCEDURE (SOFT DELETE)
// ============================================
export async function deleteProcedure(payload: {
  procedureId: string;
  user: any;
}): Promise<Result> {
  try {
    const { procedureId } = payload;

    // Check if procedure exists
    const existingProcedure = await prisma.procedures.findUnique({
      where: { proc_id: procedureId },
    });

    if (!existingProcedure) {
      return {
        success: false,
        statusCode: 404,
        message: "Procedure not found",
      };
    }

    if (!existingProcedure.is_active) {
      return {
        success: false,
        statusCode: 400,
        message: "Procedure already deleted",
      };
    }

    // Check for existing requests linked to this procedure
    const requestCount = await prisma.requests.count({
      where: { proc_id: procedureId },
    });

    if (requestCount > 0) {
      // If requests exist, ONLY deactivate (don't set deleted_at)
      await prisma.procedures.update({
        where: { proc_id: procedureId },
        data: {
          is_active: false,
        },
      });

      // Update Firestore accordingly
      await firestore
        .collection("procedures")
        .doc(procedureId)
        .update({
          is_active: false,
        });

      return {
        success: true,
        statusCode: 200,
        message: "Procedure deactivated (preserved for historical requests)",
      };
    } else {
      // If NO requests exist, perform a soft delete (set deleted_at)
      await prisma.procedures.update({
        where: { proc_id: procedureId },
        data: {
          is_active: false,
          deleted_at: new Date(),
        },
      });

      // Mark as deleted in Firestore
      await firestore
        .collection("procedures")
        .doc(procedureId)
        .update({
          is_active: false,
          deleted_at: admin.firestore.FieldValue.serverTimestamp(),
        });

      return {
        success: true,
        statusCode: 200,
        message: "Procedure deleted successfully (safe to remove)",
      };
    }
  } catch (error) {
    console.error("deleteProcedure error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}
// ============================================
// DEPARTMENTS CRUD
// ============================================

export async function getDepartments(): Promise<Result> {
  try {
    const departments = await prisma.departments.findMany({
      where: { deleted_at: null },
      orderBy: { dept_name: 'asc' }
    });
    return { success: true, statusCode: 200, message: "Departments fetched", data: departments };
  } catch (error) {
    console.error("getDepartments error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function createDepartment(payload: { dept_id?: number, dept_name: string }): Promise<Result> {
  try {
    const department = await prisma.departments.create({
      data: {
        dept_name: payload.dept_name,
        is_active: true
      }
    });
    return { success: true, statusCode: 201, message: "Department created", data: department };
  } catch (error) {
    console.error("createDepartment error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function updateDepartment(payload: { dept_id: number, dept_name: string, is_active: boolean }): Promise<Result> {
  try {
    const department = await prisma.departments.update({
      where: { dept_id: payload.dept_id },
      data: {
        dept_name: payload.dept_name,
        is_active: payload.is_active
      }
    });
    return { success: true, statusCode: 200, message: "Department updated", data: department };
  } catch (error) {
    console.error("updateDepartment error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function deleteDepartment(dept_id: number): Promise<Result> {
  try {
    await prisma.departments.update({
      where: { dept_id },
      data: { is_active: false, deleted_at: new Date() }
    });
    return { success: true, statusCode: 200, message: "Department deleted" };
  } catch (error) {
    console.error("deleteDepartment error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

// ============================================
// BATCHES CRUD
// ============================================

export async function getBatches(): Promise<Result> {
  try {
    const batches = await prisma.batches.findMany({
      where: { deleted_at: null },
      orderBy: { batch: 'desc' }
    });
    return { success: true, statusCode: 200, message: "Batches fetched", data: batches };
  } catch (error) {
    console.error("getBatches error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function createBatch(payload: { batch_id?: number, batch: string }): Promise<Result> {
  try {
    const batch = await prisma.batches.create({
      data: {
        batch: payload.batch,
        is_active: true
      }
    });
    return { success: true, statusCode: 201, message: "Batch created", data: batch };
  } catch (error) {
    console.error("createBatch error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function updateBatch(payload: { batch_id: number, batch: string, is_active: boolean }): Promise<Result> {
  try {
    const batch = await prisma.batches.update({
      where: { batch_id: payload.batch_id },
      data: {
        batch: payload.batch,
        is_active: payload.is_active
      }
    });
    return { success: true, statusCode: 200, message: "Batch updated", data: batch };
  } catch (error) {
    console.error("updateBatch error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function deleteBatch(batch_id: number): Promise<Result> {
  try {
    await prisma.batches.update({
      where: { batch_id },
      data: { is_active: false, deleted_at: new Date() }
    });
    return { success: true, statusCode: 200, message: "Batch deleted" };
  } catch (error) {
    console.error("deleteBatch error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

// ============================================
// CLASSES CRUD
// ============================================

export async function getClasses(batchId?: number): Promise<Result> {
  try {
    const whereClause: any = { deleted_at: null };
    if (batchId) {
      whereClause.batch_id = batchId;
    }
    const classes = await prisma.classes.findMany({
      where: whereClause,
      include: {
        Departments: true,
        Batches: true,
        ClassFaculty: {
          where: { is_active: true },
          include: {
            Faculty: true,
            Roles: true
          }
        }
      },
      orderBy: { class: 'asc' }
    });
    return { success: true, statusCode: 200, message: "Classes fetched", data: classes };
  } catch (error) {
    console.error("getClasses error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function createClass(payload: {
  class_id?: number,
  batch_id: number,
  class: string,
  dept_id: number
}): Promise<Result> {
  try {
    const data: any = {
      batch_id: payload.batch_id,
      class: payload.class,
      dept_id: payload.dept_id,
      is_active: true
    };
    if (payload.class_id) {
      data.class_id = payload.class_id;
    }
    const newClass = await prisma.classes.create({
      data: data
    });
    return { success: true, statusCode: 201, message: "Class created", data: newClass };
  } catch (error) {
    console.error("createClass error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function updateClass(payload: {
  class_id: number,
  batch_id: number,
  class: string,
  dept_id: number,
  is_active: boolean
}): Promise<Result> {
  try {
    const updatedClass = await prisma.classes.update({
      where: { class_id: payload.class_id },
      data: {
        batch_id: payload.batch_id,
        class: payload.class,
        dept_id: payload.dept_id,
        is_active: payload.is_active
      }
    });
    return { success: true, statusCode: 200, message: "Class updated", data: updatedClass };
  } catch (error) {
    console.error("updateClass error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function deleteClass(class_id: number): Promise<Result> {
  try {
    await prisma.classes.update({
      where: { class_id },
      data: { is_active: false, deleted_at: new Date() }
    });
    return { success: true, statusCode: 200, message: "Class deleted" };
  } catch (error) {
    console.error("deleteClass error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

// ============================================
// USERS MANAGEMENT
// ============================================

export async function getUsersService(search?: string): Promise<Result> {
  try {
    const whereClause: any = { deleted_at: null };

    if (search) {
      whereClause.OR = [
        { mits_uid: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        {
          Student: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          Faculty: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const users = await prisma.userAccount.findMany({
      where: whereClause,
      include: {
        Faculty: {
          include: {
            Departments: true,
          },
        },
        Student: {
          include: {
            Classes: {
              include: {
                Departments: true,
              },
            },
            Batches: true,
          },
        },
        RoleMapping: {
          where: { is_active: true },
          include: {
            Roles: true,
          },
        },
        UserTypes: true,
      },
      orderBy: { mits_uid: 'asc' },
    });

    return {
      success: true,
      statusCode: 200,
      message: "Users fetched successfully",
      data: users,
    };
  } catch (error) {
    console.error("getUsersService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function updateUserService(payload: {
  mits_uid: string;
  name?: string;
  email?: string;
  is_active?: boolean;
  role_ids?: number[]; // Updated to accept multiple role IDs
}): Promise<Result> {
  try {
    const { mits_uid, name, email, is_active, role_ids } = payload;

    const user = await prisma.userAccount.findUnique({
      where: { mits_uid },
      include: { UserTypes: true },
    });

    if (!user) {
      return { success: false, statusCode: 404, message: "User not found" };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Update UserAccount
      if (is_active !== undefined || email !== undefined) {
        await tx.userAccount.update({
          where: { mits_uid },
          data: {
            ...(is_active !== undefined && { is_active }),
            ...(email && { email }),
          },
        });
      }

      // 2. Update Profile
      if (user.UserTypes.user_type_tag === "FACULTY") {
        await tx.faculty.update({
          where: { mits_uid },
          data: {
            ...(name !== undefined && { name }),
            ...(email && { email }),
            ...(is_active !== undefined && { is_active }),
          },
        });
      } else if (user.UserTypes.user_type_tag === "STUDENT") {
        await tx.student.update({
          where: { mits_uid },
          data: {
            ...(name !== undefined && { name }),
            ...(is_active !== undefined && { is_active }),
          },
        });
      }

      // 3. Update RoleMapping (Sync logic)
      if (role_ids !== undefined) {
        // Fetch current active roles
        const currentMappings = await tx.roleMapping.findMany({
          where: { mits_uid, is_active: true },
        });
        const currentRoleIds = currentMappings.map(m => m.role_id);

        // Roles to deactivate
        const toDeactivate = currentMappings.filter(m => !role_ids.includes(m.role_id));
        if (toDeactivate.length > 0) {
          await tx.roleMapping.updateMany({
            where: {
              role_mapping_id: { in: toDeactivate.map(m => m.role_mapping_id) },
            },
            data: { is_active: false },
          });
        }

        // Roles to add
        const toAdd = role_ids.filter(rid => !currentRoleIds.includes(rid));
        for (const rid of toAdd) {
          const maxId = await tx.roleMapping.aggregate({
            _max: { role_mapping_id: true },
          });
          const newId = (maxId._max.role_mapping_id || 0) + 1;

          await tx.roleMapping.create({
            data: {
              role_mapping_id: newId,
              role_id: rid,
              mits_uid,
              is_active: true,
            },
          });
        }
      }
    });

    return {
      success: true,
      statusCode: 200,
      message: "User updated successfully",
    };
  } catch (error) {
    console.error("updateUserService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function createUserService(payload: {
  mits_uid: string;
  name: string;
  email?: string;
  user_type_tag?: string;
  role_ids?: number[];
  profileData?: any;
}): Promise<Result> {
  const newlyCreatedFirebaseUids: string[] = [];
  try {
    const { mits_uid, name, email, user_type_tag = "FACULTY", role_ids, profileData } = payload;

    const normalizedType = (user_type_tag || "FACULTY").toUpperCase();
    const shouldWhitelist = normalizedType !== "STUDENT";
    const whitelistRole: "faculty" | "admin" = normalizedType === "ADMIN" ? "admin" : "faculty";

    // 1. Validation
    const existing = await prisma.userAccount.findUnique({
      where: { mits_uid },
    });
    if (existing) {
      return { success: false, statusCode: 400, message: `User with MITS ID ${mits_uid} already exists` };
    }

    if (email) {
      const existingEmail = await prisma.userAccount.findFirst({
        where: { email },
      });
      if (existingEmail) {
        return { success: false, statusCode: 400, message: `User with email ${email} already exists` };
      }
    }

    const type = await prisma.userTypes.findFirst({
      where: { user_type_tag: (user_type_tag || "FACULTY").toUpperCase() },
    });
    if (!type) {
      return { success: false, statusCode: 400, message: `Invalid user type: ${user_type_tag}` };
    }

    // 2. Firebase User
    let auth_uid = `temp_${mits_uid}`;
    if (email) {
      try {
        const userRecord = await firebaseAuth.createUser({
          email: email,
          password: "ChangeMe123!",
          displayName: name,
        });
        auth_uid = userRecord.uid;
        newlyCreatedFirebaseUids.push(auth_uid);
      } catch (fbError: any) {
        if (fbError.code === 'auth/email-already-exists') {
          const existingUser = await firebaseAuth.getUserByEmail(email);
          auth_uid = existingUser.uid;
        } else {
          throw fbError;
        }
      }
    }

    // 3. Database Transaction
    await prisma.$transaction(async (tx) => {
      // UserAccount
      await tx.userAccount.create({
        data: { mits_uid, auth_uid, email: email ?? null, user_type: type.user_type_id },
      });

      // Profile
      if (type.user_type_tag === "STUDENT") {
        await tx.student.create({
          data: {
            mits_uid,
            name,
            batch_id: Number(profileData?.batch_id),
            class_id: Number(profileData?.class_id),
            hosteller: profileData?.hosteller === 'true' || profileData?.hosteller === true,
            gender: profileData?.gender,
            phone: profileData?.phone,
          },
        });
      } else if (type.user_type_tag === "FACULTY") {
        let deptId = Number(profileData?.department_id);

        // Fallback for high-level roles added without a specific department
        if (isNaN(deptId) || !deptId) {
          const adminDept = await tx.departments.findFirst({
            where: { dept_name: { contains: 'Administration', mode: 'insensitive' } }
          });
          const generalDept = await tx.departments.findFirst({
            where: { dept_name: { contains: 'General', mode: 'insensitive' } }
          });
          const anyDept = await tx.departments.findFirst();

          deptId = adminDept?.dept_id || generalDept?.dept_id || anyDept?.dept_id || 1;
        }

        await tx.faculty.create({
          data: {
            mits_uid,
            name,
            department_id: deptId,
            email: email ?? null
          },
        });
      }

      // Role Mapping
      if (role_ids && role_ids.length > 0) {
        for (const rid of role_ids) {
          const maxId = await tx.roleMapping.aggregate({ _max: { role_mapping_id: true } });
          const nextId = (maxId._max.role_mapping_id || 0) + 1;
          await tx.roleMapping.create({
            data: {
              role_mapping_id: nextId,
              role_id: rid,
              mits_uid,
              is_active: true
            }
          });
        }
      }
    });

    if (shouldWhitelist) {
      const emailPrefix = email ? email.split("@")[0] : mits_uid;
      await firestore
        .collection("userDetails")
        .doc(emailPrefix!)
        .set(
          {
            role: whitelistRole,
            uid: emailPrefix,
            email: email ?? null,
          },
          { merge: true }
        );
    }

    return {
      success: true,
      statusCode: 201,
      message: "User created successfully",
    };
  } catch (error: any) {
    console.error("createUserService error:", error);

    // Rollback Firebase
    for (const uid of newlyCreatedFirebaseUids) {
      try { await firebaseAuth.deleteUser(uid); } catch (e) { }
    }

    return {
      success: false,
      statusCode: 500,
      message: `Failed to create user: ${error.message}`,
    };
  }
}

export async function getRolesService(): Promise<Result> {
  try {
    const roles = await prisma.roles.findMany({
      where: { is_active: true },
      orderBy: { role_tag: "asc" },
    });
    return {
      success: true,
      statusCode: 200,
      message: "Roles fetched",
      data: roles,
    };
  } catch (error) {
    console.error("getRolesService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function createRoleService(payload: {
  role_id?: number;
  role_tag: string;
  role_desc: string;
}): Promise<Result> {
  try {
    const { role_id, role_tag, role_desc } = payload;

    const existing = await prisma.roles.findUnique({
      where: { role_tag: role_tag.toUpperCase() },
    });

    if (existing) {
      return {
        success: false,
        statusCode: 400,
        message: "Role tag already exists",
      };
    }

    await prisma.roles.create({
      data: {
        //role_id ,
        role_tag: role_tag.toUpperCase(),
        role_desc,
        is_active: true,
      },
    });

    return {
      success: true,
      statusCode: 201,
      message: "Role created successfully",
    };
  } catch (error) {
    console.error("createRoleService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function updateRoleService(payload: {
  role_id: number;
  role_tag: string;
  role_desc: string;
  is_active: boolean;
}): Promise<Result> {
  try {
    const { role_id, role_tag, role_desc, is_active } = payload;
    const role = await prisma.roles.update({
      where: { role_id },
      data: {
        role_tag: role_tag.toUpperCase(),
        role_desc,
        is_active,
      },
    });
    return { success: true, statusCode: 200, message: "Role updated", data: role };
  } catch (error) {
    console.error("updateRoleService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function deleteRoleService(role_id: number): Promise<Result> {
  try {
    await prisma.roles.update({
      where: { role_id },
      data: { is_active: false, deleted_at: new Date() },
    });
    return { success: true, statusCode: 200, message: "Role deleted" };
  } catch (error) {
    console.error("deleteRoleService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getUserTypesService(): Promise<Result> {
  try {
    const userTypes = await prisma.userTypes.findMany({
      where: { is_active: true },
      orderBy: { user_type_id: "asc" },
    });
    return {
      success: true,
      statusCode: 200,
      message: "User types fetched",
      data: userTypes,
    };
  } catch (error) {
    console.error("getUserTypesService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

// ============================================
// GLOBAL REQUESTS (INSTITUTIONAL OVERSIGHT)
// ============================================

export async function getGlobalRequestsService(): Promise<Result> {
  try {
    const requests = await prisma.requests.findMany({
      include: {
        Procedures: true,
      },
      orderBy: { created_at: 'desc' }
    });

    const formatted = [];

    for (const req of requests) {
      let current_level = 1;
      let total_levels = 1;
      let approvalHistory: any[] = [];
      let status_text = "Pending";
      let color = "warning";

      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (snap.exists) {
        const data = snap.data()!;
        current_level = data.current_level || 1;

        const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
        const procData = procDoc.exists ? procDoc.data() : null;
        total_levels = procData?.approvalLevels?.length || 1;

        const statusResult = await resolveRequestStatus(req, procData, current_level);
        status_text = statusResult.text;
        color = statusResult.color;

        const historyBlocks = (data.approval_progress || []);
        for (const block of historyBlocks) {
          const levelDefHistory = procData?.approvalLevels?.find((l: any) => l.level === block.level);
          const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
          for (const decision of block.decisions) {
            if (decision.decision) {
              const histEntry = {
                level: block.level,
                approverName: await getUserNameFromUid(decision.mits_uid),
                role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
                status: decision.decision,
                comments: decision.comments,
                timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
              };
              approvalHistory.push(histEntry);
            }
          }
        }

        const userData = await prisma.userAccount.findUnique({
          where: { mits_uid: req.created_by },
          include: {
            Student: { include: { Classes: { include: { Departments: true } } } },
            Faculty: { include: { Departments: true } }
          }
        });

        formatted.push({
          req_id: req.req_id,
          procedure_title: req.Procedures?.title || "Unknown Request",
          created_at: req.created_at,
          status: req.status,
          status_text,
          color,
          current_level,
          total_levels,
          approvalHistory,
          formData: data.formData || {},
          studentName: userData?.Student?.name || userData?.Faculty?.name || data.studentName || "Unknown",
          studentId: req.created_by,
          department: userData?.Student?.Classes?.Departments?.dept_name || userData?.Faculty?.Departments?.dept_name || "N/A",
        });
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: "Global requests fetched",
      data: formatted
    };
  } catch (error) {
    console.error("getGlobalRequestsService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error"
    };
  }
}

// ============================================
// BULK IMPORT SERVICES
// ============================================

export async function bulkImportAcademicService(payload: {
  departments: any[];
  batches: any[];
  classes: any[];
}): Promise<Result> {
  try {
    await prisma.$transaction(async (tx) => {
      if (payload.departments && payload.departments.length > 0) {
        await tx.departments.createMany({
          data: payload.departments.map((d: any) => ({
            dept_id: Number(d.dept_id),
            dept_name: d.dept_name,
            is_active: true,
          })),
          skipDuplicates: true,
        });
      }
      if (payload.batches && payload.batches.length > 0) {
        await tx.batches.createMany({
          data: payload.batches.map((b: any) => ({
            batch_id: Number(b.batch_id),
            batch: b.batch,
            is_active: true,
          })),
          skipDuplicates: true,
        });
      }
      if (payload.classes && payload.classes.length > 0) {
        await tx.classes.createMany({
          data: payload.classes.map((c: any) => ({
            class_id: Number(c.class_id),
            batch_id: Number(c.batch_id),
            class: c.class,
            dept_id: Number(c.dept_id),
            is_active: true,
          })),
          skipDuplicates: true,
        });
      }
    });

    return {
      success: true,
      statusCode: 201,
      message: "Academic structure imported successfully",
    };
  } catch (error) {
    console.error("bulkImportAcademicService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}

export async function bulkImportUsersService(payload: {
  users: any[];
  defaultUserType?: string;
}): Promise<Result> {
  let rowNum = 2; // Assuming header is line 1
  const whitelistEntries: Array<{
    docId: string;
    role: "faculty" | "admin";
    uid: string;
    email: string | null;
  }> = [];

  try {
    const userTypes = await prisma.userTypes.findMany();
    const roles = await prisma.roles.findMany();
    const allBatches = await prisma.batches.findMany({ where: { is_active: true } });
    const allClasses = await prisma.classes.findMany({ where: { is_active: true } });
    const allDepartments = await prisma.departments.findMany({ where: { is_active: true } });

    // Helper to get value by case-insensitive key
    const getVal = (row: any, key: string) => {
      const foundKey = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]/g, '') === key.toLowerCase().replace(/[\s_]/g, ''));
      return foundKey ? row[foundKey] : undefined;
    };

    await prisma.$transaction(async (tx) => {
      for (const data of payload.users) {
        const mits_uid = getVal(data, "mits_uid");
        const name = getVal(data, "name");
        const email = getVal(data, "email");
        const profileData = data;

        // Skip empty rows
        if (!mits_uid && !name && !email) {
          rowNum++;
          continue;
        }

        if (!mits_uid) throw new Error(`Error at line ${rowNum}: MITS ID (mits_uid) is required. Headers received: ${Object.keys(data).join(", ")}`);

        let user_type_tag = getVal(data, "user_type_tag") || payload.defaultUserType;

        const type = userTypes.find(t => t.user_type_tag === user_type_tag.toUpperCase());
        if (!type) throw new Error(`Error at line ${rowNum}: Invalid user type: ${user_type_tag}`);

        const normalizedType = user_type_tag.toUpperCase();

        // 1. Determine auth_uid for Whitelist
        let auth_uid = `temp_${mits_uid}`;
        if (email) {
          try {
            const firebaseUser = await firebaseAuth.getUserByEmail(email);
            auth_uid = firebaseUser.uid;
          } catch (e) {
            // User doesn't exist in Firebase yet
          }
        }

        // 2. Prepare Whitelist Entry (Firestore)
        const shouldWhitelist = normalizedType !== "STUDENT";
        if (shouldWhitelist) {
          const docId = email ? email.split("@")[0] : mits_uid;
          const role: "faculty" | "admin" = normalizedType === "ADMIN" ? "admin" : "faculty";
          whitelistEntries.push({ docId, role, uid: auth_uid, email: email ?? null });
        }

        // 3. Create/Update Profile (Student or Faculty/Admin)
        if (normalizedType === "STUDENT") {
          const batchInput = profileData.batch_id || profileData.batch;
          const classInput = profileData.class_id || profileData.class;

          // Resolve Batch
          const batch = allBatches.find(b =>
            b.batch_id === Number(batchInput) ||
            b.batch.toLowerCase().trim() === String(batchInput).toLowerCase().trim()
          );
          if (!batch) throw new Error(`Error at line ${rowNum}: Batch "${batchInput}" not found.`);
          const batch_id = batch.batch_id;

          // Resolve Class
          const cls = allClasses.find(c =>
            c.batch_id === batch_id && (
              c.class_id === Number(classInput) ||
              c.class.toLowerCase().trim() === String(classInput).toLowerCase().trim()
            )
          );
          if (!cls) throw new Error(`Error at line ${rowNum}: Class "${classInput}" not found for batch "${batch.batch}".`);
          const class_id = cls.class_id;

          await tx.student.upsert({
            where: { mits_uid },
            update: {
              name,
              batch_id,
              class_id,
              hosteller: String(profileData.hosteller).toLowerCase() === 'true',
              gender: profileData.gender,
              phone: profileData.phone,
            },
            create: {
              mits_uid,
              name,
              batch_id,
              class_id,
              hosteller: String(profileData.hosteller).toLowerCase() === 'true',
              gender: profileData.gender,
              phone: profileData.phone,
            },
          });
        } else if (normalizedType === "FACULTY" || normalizedType === "ADMIN") {
          const deptInput = profileData.department_id || profileData.department;
          const dept = allDepartments.find(d =>
            d.dept_id === Number(deptInput) ||
            d.dept_name.toLowerCase().trim() === String(deptInput).toLowerCase().trim()
          );

          if (!dept) throw new Error(`Error at line ${rowNum}: Department "${deptInput}" not found.`);
          const department_id = dept.dept_id;

          await tx.faculty.upsert({
            where: { mits_uid },
            update: {
              name,
              department_id,
              email: email ?? null
            },
            create: {
              mits_uid,
              name,
              department_id,
              email: email ?? null
            },
          });
        }

        // 4. Handle Global Role Mapping
        if (normalizedType !== "FACULTY" && normalizedType !== "ADMIN" && (profileData.role_tag || profileData.club_role_tag)) {
          const desiredTag = (profileData.role_tag || profileData.club_role_tag).toUpperCase();
          const role = roles.find(r => r.role_tag === desiredTag);
          if (role) {
            const maxId = await tx.roleMapping.aggregate({ _max: { role_mapping_id: true } });
            const nextId = (maxId._max.role_mapping_id || 0) + 1;
            await tx.roleMapping.create({
              data: {
                role_mapping_id: nextId,
                role_id: role.role_id,
                mits_uid,
                is_active: true
              }
            });
          }
        }
        rowNum++;
      }
    }, { timeout: 30000 });

    // 5. Update Firestore Whitelist
    const whitelistFailures: string[] = [];
    for (const entry of whitelistEntries) {
      try {
        await firestore
          .collection("userDetails")
          .doc(entry.docId)
          .set(
            {
              role: entry.role,
              uid: entry.uid,
              email: entry.email,
            },
            { merge: true }
          );
      } catch (err) {
        console.error(`Failed to update userDetails for ${entry.docId}:`, err);
        whitelistFailures.push(entry.docId);
      }
    }

    if (whitelistFailures.length > 0) {
      return {
        success: false,
        statusCode: 500,
        message: `Users imported, but failed to update whitelist for: ${whitelistFailures.join(", ")}`,
      };
    }

    return {
      success: true,
      statusCode: 201,
      message: `All ${payload.users.length} users imported successfully.`,
    };
  } catch (error: any) {
    console.error("bulkImportUsersService error:", error);

    return {
      success: false,
      statusCode: 400,
      message: error.message.startsWith("Error at line") ? error.message : `Internal server error: ${error.message}`,
    };
  }
}

export async function getAdminDashboardStatsService(): Promise<Result> {
  try {
    const totalRequests = await prisma.requests.count();
    const pendingRequests = await prisma.requests.count({ where: { status: 0 } });
    const approvedRequests = await prisma.requests.count({ where: { status: 1 } });
    const rejectedRequests = await prisma.requests.count({ where: { status: 2 } });

    const recentRequests = await prisma.requests.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      include: { Procedures: true }
    });

    const recentActivity = [];
    for (const req of recentRequests) {
      const snap = await firestore.collection("requests").doc(req.req_id).get();
      let title = "";
      let initials = "??";
      let time = req.created_at;

      if (snap.exists) {
        const data = snap.data()!;
        const progress = data.approval_progress || [];

        // Find the absolute last decision
        let lastDecision: any = null;
        for (const block of progress) {
          if (block.decisions && block.decisions.length > 0) {
            const dec = block.decisions[block.decisions.length - 1];
            if (dec.decision) {
              lastDecision = dec;
            }
          }
        }

        if (lastDecision) {
          const approverName = await getUserNameFromUid(lastDecision.mits_uid);
          title = `${approverName} ${lastDecision.decision.toLowerCase()} Request for ${req.Procedures?.title || "Unknown"}`;
          initials = approverName.split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2);
          if (lastDecision.timestamp) time = new Date(lastDecision.timestamp);
        } else {
          const requesterName = await getUserNameFromUid(req.created_by);
          title = `${requesterName} created Request for ${req.Procedures?.title || "Unknown"}`;
          initials = requesterName.split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2);
        }
      } else {
        const requesterName = await getUserNameFromUid(req.created_by);
        title = `${requesterName} created Request for ${req.Procedures?.title || "Unknown"}`;
        initials = requesterName.split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2);
      }

      recentActivity.push({
        initials,
        title,
        subtitle: req.Procedures?.title || "Unknown Procedure",
        time: time.toISOString()
      });
    }

    return {
      success: true,
      statusCode: 200,
      message: "Dashboard stats fetched",
      data: {
        stats: {
          total: totalRequests,
          pending: pendingRequests,
          approved: approvedRequests,
          rejected: rejectedRequests
        },
        recentActivity
      }
    };
  } catch (error) {
    console.error("getAdminDashboardStatsService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error"
    };
  }
}
// ============================================
// DEPARTMENT FACULTY (HOD / ASST. HOD)
// ============================================

export async function getDepartmentFacultyRoles(dept_id: number): Promise<Result> {
  try {
    const roles = await prisma.departmentFaculty.findMany({
      where: {
        dept_id: dept_id,
        is_active: true,
        deleted_at: null
      },
      include: {
        Faculty: true,
        Roles: true
      }
    });

    return {
      success: true,
      statusCode: 200,
      message: "Department faculty roles fetched",
      data: roles
    };
  } catch (error) {
    console.error("getDepartmentFacultyRoles error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function assignDepartmentRole(payload: {
  dept_id: number,
  mits_uid: string,
  role_tag: string
}): Promise<Result> {
  try {
    const { dept_id, mits_uid, role_tag } = payload;

    // 1. Find the role_id for the tag (case-insensitive)
    const role = await prisma.roles.findFirst({
      where: {
        role_tag: { equals: role_tag, mode: 'insensitive' }
      }
    });

    if (!role) {
      return { success: false, statusCode: 404, message: `Role ${role_tag} not found` };
    }

    // 2. REPLACEMENT LOGIC: Deactivate anyone else in THIS department holding THIS role
    // This allows "Edit/Replace" by simply assigning a new person
    await prisma.departmentFaculty.updateMany({
      where: {
        dept_id: dept_id,
        role_id: role.role_id,
        is_active: true
      },
      data: {
        is_active: false,
        deleted_at: new Date()
      }
    });

    // 3. Upsert the department faculty record for the new person
    await prisma.departmentFaculty.upsert({
      where: { mits_uid: mits_uid },
      create: {
        mits_uid: mits_uid,
        dept_id: dept_id,
        role_id: role.role_id,
        is_active: true
      },
      update: {
        dept_id: dept_id,
        role_id: role.role_id,
        is_active: true,
        deleted_at: null
      }
    });

    return {
      success: true,
      statusCode: 200,
      message: "Department role assigned successfully"
    };
  } catch (error) {
    console.error("assignDepartmentRole error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function removeDepartmentRole(payload: {
  mits_uid: string
}): Promise<Result> {
  try {
    await prisma.departmentFaculty.update({
      where: { mits_uid: payload.mits_uid },
      data: {
        is_active: false,
        deleted_at: new Date()
      }
    });
    return { success: true, statusCode: 200, message: "Role removed successfully" };
  } catch (error) {
    console.error("removeDepartmentRole error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

// ============================================
// CLASS FACULTY MANAGEMENT
// ============================================

export async function getClassFacultyRoles(classId: number): Promise<Result> {
  try {
    const roles = await prisma.classFaculty.findMany({
      where: {
        class_id: classId,
        is_active: true
      },
      include: {
        Faculty: true,
        Roles: true
      }
    });
    return { success: true, statusCode: 200, message: "Class faculty roles fetched", data: roles };
  } catch (error) {
    console.error("getClassFacultyRoles error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function assignClassRole(payload: {
  class_id: number,
  mits_uid: string,
  role_tag: string
}): Promise<Result> {
  try {
    const { class_id, mits_uid, role_tag } = payload;

    // 1. Find role_id (case-insensitive) - although we use role_tag in ClassFaculty table directly
    // The schema says ClassFaculty links to Roles via role_tag.
    let role = await prisma.roles.findFirst({
      where: {
        role_tag: { equals: role_tag, mode: 'insensitive' }
      }
    });

    if (!role) {
      if (role_tag.toUpperCase() === 'CLASS_ADVISOR') {
        role = await prisma.roles.create({
          data: {
            role_tag: 'CLASS_ADVISOR',
            role_desc: 'Class Advisor',
            is_active: true
          }
        });
      } else {
        return { success: false, statusCode: 404, message: `Role ${role_tag} not found` };
      }
    }

    // Since ClassFaculty has a composite primary key [class_id, mits_uid, role_tag], 
    // and we want to allow "re-assignment" (e.g. if someone was deleted before), we use upsert.
    // However, the rule is typically "2 advisors". We might want to allow multiple under same tag?
    // User said "2 class advisors". This usually means index 1 and index 2 or just two entries with 'CLASS_ADVISOR' tag.
    // If it's just 'CLASS_ADVISOR' tag, then they are distinct by mits_uid.

    await prisma.classFaculty.upsert({
      where: {
        class_id_mits_uid_role_tag: {
          class_id,
          mits_uid,
          role_tag: role.role_tag
        }
      },
      create: {
        class_id,
        mits_uid,
        role_tag: role.role_tag,
        is_active: true
      },
      update: {
        is_active: true,
        deleted_at: null
      }
    });

    return { success: true, statusCode: 200, message: "Class advisor assigned successfully" };
  } catch (error) {
    console.error("assignClassRole error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function removeClassRole(payload: {
  class_id: number,
  mits_uid: string,
  role_tag: string
}): Promise<Result> {
  try {
    await prisma.classFaculty.update({
      where: {
        class_id_mits_uid_role_tag: {
          class_id: payload.class_id,
          mits_uid: payload.mits_uid,
          role_tag: payload.role_tag
        }
      },
      data: {
        is_active: false,
        deleted_at: new Date()
      }
    });
    return { success: true, statusCode: 200, message: "Class role removed successfully" };
  } catch (error) {
    console.error("removeClassRole error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}
export async function bulkImportClubsService(payload: {
  clubs: any[];
}): Promise<Result> {
  try {
    const roles = await prisma.roles.findMany();
    const departments = await prisma.departments.findMany();
    const allBatches = await prisma.batches.findMany(); // Added for academic data context

    // Helper to get value by case-insensitive key
    const getVal = (row: any, key: string) => {
      const foundKey = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]/g, '') === key.toLowerCase().replace(/[\s_]/g, ''));
      return foundKey ? row[foundKey] : undefined;
    };

    await prisma.$transaction(async (tx) => {
      // Get current max IDs since they aren't autoincrementing in some schemas
      const maxClub = await tx.clubs.aggregate({ _max: { club_id: true } });
      let nextClubId = (maxClub._max.club_id || 0) + 1;

      const maxClubAdmin = await tx.clubAdmin.aggregate({ _max: { club_admin_id: true } });
      let nextClubAdminId = (maxClubAdmin._max.club_admin_id || 0) + 1;

      const maxRoleMapping = await tx.roleMapping.aggregate({ _max: { role_mapping_id: true } });
      let nextRoleMappingId = (maxRoleMapping._max.role_mapping_id || 0) + 1;

      // Helper to resolve name to UID within the transaction
      const resolveUserUid = async (input: string | undefined): Promise<string | undefined> => {
        if (!input) return undefined;
        const normalizedInput = input.trim();

        // 1. Check if it's already a mits_uid (exists in UserAccount) - Case Insensitive
        const user = await tx.userAccount.findFirst({
          where: { mits_uid: { equals: normalizedInput, mode: 'insensitive' } }
        });
        if (user) return user.mits_uid;

        // 2. Search in Student by mits_uid or name - Case Insensitive
        const student = await tx.student.findFirst({
          where: {
            OR: [
              { mits_uid: { equals: normalizedInput, mode: 'insensitive' } },
              { name: { contains: normalizedInput, mode: 'insensitive' } }
            ]
          }
        });
        if (student) return student.mits_uid;

        // 3. Search in Faculty by mits_uid or name - Case Insensitive
        const faculty = await tx.faculty.findFirst({
          where: {
            OR: [
              { mits_uid: { equals: normalizedInput, mode: 'insensitive' } },
              { name: { contains: normalizedInput, mode: 'insensitive' } }
            ]
          }
        });
        if (faculty) return faculty.mits_uid;

        return normalizedInput; // Fallback to trimmed input
      };

      let rowNum = 2; // Header is line 1

      // Helper to get value by more flexible case-insensitive key
      const getVal = (row: any, target: string) => {
        const normalizedTarget = target.toLowerCase().replace(/[\s_]/g, '');
        const foundKey = Object.keys(row).find(k => {
          const normalizedK = k.toLowerCase().replace(/[\s_]/g, '');
          return normalizedK === normalizedTarget ||
            normalizedK.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedK);
        });
        return foundKey ? row[foundKey] : undefined;
      };

      for (const row of payload.clubs) {
        const club_name = getVal(row, "clubname") || getVal(row, "name");
        const club_department = getVal(row, "clubdepartment") || getVal(row, "department");
        const club_lead = getVal(row, "clublead") || getVal(row, "lead") || getVal(row, "leadid");
        const club_coordinator = getVal(row, "clubcoordinator") || getVal(row, "coordinator") || getVal(row, "coordinatorid");

        // Skip empty rows
        if (!club_name && !club_lead && !club_coordinator && !club_department) {
          rowNum++;
          continue;
        }

        if (!club_name) throw new Error(`Error at line ${rowNum}: Club name is required. Headers received: ${Object.keys(row).join(", ")}`);

        // 1. Resolve Department
        const dept = departments.find(d => d.dept_name.toLowerCase() === club_department?.toLowerCase());
        const dept_id = dept ? dept.dept_id : null;

        // 2. Resolve Lead and Coordinator UIDs
        const leadUid = await resolveUserUid(club_lead);
        const coordUid = await resolveUserUid(club_coordinator);

        console.log(`Row ${rowNum}: club_name=${club_name}, club_lead=${club_lead} -> leadUid=${leadUid}, club_coordinator=${club_coordinator} -> coordUid=${coordUid}`);

        // 3. Generate/Ensure Role Tags
        const sanitizedName = club_name.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
        const leadTag = `CLUB_LEAD_${sanitizedName}`;
        const coordTag = `CLUB_COORD_${sanitizedName}`;

        // Ensure Lead Role
        let leadRole = roles.find(r => r.role_tag === leadTag);
        if (!leadRole) {
          leadRole = await tx.roles.create({
            data: { role_tag: leadTag, role_desc: `Lead of ${club_name}`, is_active: true }
          });
        }

        // Ensure Coordinator Role
        let coordRole = roles.find(r => r.role_tag === coordTag);
        if (!coordRole) {
          coordRole = await tx.roles.create({
            data: { role_tag: coordTag, role_desc: `Coordinator of ${club_name}`, is_active: true }
          });
        }

        // 4. Create Club
        await tx.clubs.create({
          data: {
            club_id: nextClubId,
            club_name: club_name,
            dept_id: dept_id,
            coordinator_role_tag: coordTag,
            is_active: true
          }
        });

        // 5. Link Lead in ClubAdmin
        await tx.clubAdmin.create({
          data: {
            club_admin_id: nextClubAdminId++,
            club_id: nextClubId++,
            role_tag: leadTag,
            is_active: true
          }
        });

        // 6. Create Role Mappings for specific users (if resolved)
        if (leadUid) {
          await tx.roleMapping.upsert({
            where: { role_mapping_id: nextRoleMappingId },
            create: {
              role_mapping_id: nextRoleMappingId++,
              role_id: leadRole.role_id,
              mits_uid: leadUid,
              is_active: true
            },
            update: {
              role_id: leadRole.role_id,
              is_active: true,
              deleted_at: null
            }
          });
        }

        if (coordUid) {
          await tx.roleMapping.upsert({
            where: { role_mapping_id: nextRoleMappingId },
            create: {
              role_mapping_id: nextRoleMappingId++,
              role_id: coordRole.role_id,
              mits_uid: coordUid,
              is_active: true
            },
            update: {
              role_id: coordRole.role_id,
              is_active: true,
              deleted_at: null
            }
          });
        }
        rowNum++;
      }
    });

    return {
      success: true,
      statusCode: 201,
      message: "Clubs imported successfully",
    };
  } catch (error: any) {
    console.error("bulkImportClubsService error:", error);
    return {
      success: false,
      statusCode: 500,
      message: error.message || "Internal server error"
    };
  }
}
