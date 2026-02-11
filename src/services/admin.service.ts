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
      const tags = visibility.map(v => v.toUpperCase()); // ["STUDENT", "FACULTY"]

      allowedUserTypes = userTypes.filter(
        (ut) => tags.includes(ut.user_type_tag)
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
    const { title, desc, formFields, approvalLevels, visibility } = body.procedure;

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
      const tags = visibility.map((v: string) => v.toUpperCase());
      allowedUserTypes = userTypes.filter((ut) =>
        tags.includes(ut.user_type_tag)
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

export async function createDepartment(payload: { dept_id: number, dept_name: string }): Promise<Result> {
  try {
    const department = await prisma.departments.create({
      data: {
        dept_id: payload.dept_id,
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

export async function createBatch(payload: { batch_id: number, batch: string }): Promise<Result> {
  try {
    const batch = await prisma.batches.create({
      data: {
        batch_id: payload.batch_id,
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

export async function getClasses(): Promise<Result> {
  try {
    const classes = await prisma.classes.findMany({
      where: { deleted_at: null },
      include: {
        Departments: true,
        Batches: true
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
  class_id: number,
  batch_id: number,
  class: string,
  dept_id: number
}): Promise<Result> {
  try {
    const newClass = await prisma.classes.create({
      data: {
        class_id: payload.class_id,
        batch_id: payload.batch_id,
        class: payload.class,
        dept_id: payload.dept_id,
        is_active: true
      }
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

export async function getUsersService(): Promise<Result> {
  try {
    const users = await prisma.userAccount.findMany({
      where: { deleted_at: null },
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
              }
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
  role_id?: number;
}): Promise<Result> {
  try {
    const { mits_uid, name, email, is_active, role_id } = payload;

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

      // 3. Update RoleMapping
      if (role_id !== undefined) {
        const existingMapping = await tx.roleMapping.findFirst({
          where: { mits_uid, is_active: true },
        });

        if (role_id === null) {
          // If role_id is explicitly null, deactivate any active mapping
          if (existingMapping) {
            await tx.roleMapping.update({
              where: { role_mapping_id: existingMapping.role_mapping_id },
              data: { is_active: false },
            });
          }
        } else {
          // Update existing or create new mapping
          if (existingMapping) {
            await tx.roleMapping.update({
              where: { role_mapping_id: existingMapping.role_mapping_id },
              data: { role_id },
            });
          } else {
            const maxId = await tx.roleMapping.aggregate({
              _max: { role_mapping_id: true },
            });
            const newId = (maxId._max.role_mapping_id || 0) + 1;

            await tx.roleMapping.create({
              data: {
                role_mapping_id: newId,
                role_id,
                mits_uid,
                is_active: true,
              },
            });
          }
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
