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
    // Fetch procedures from SQL
    const procedures = await prisma.procedures.findMany({
      where: {
        is_active: true,
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

    if (!procedure.is_active || procedure.deleted_at) {
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

    // Update Firestore
    await firestore
      .collection("procedures")
      .doc(procedureId)
      .update({
        title,
        desc,
        formFields,
        approvalLevels,
        visibility,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Update SQL metadata
    await prisma.procedures.update({
      where: { proc_id: procedureId },
      data: {
        title: title,
        desc_first_50_char: JSON.stringify(desc).slice(0, 50),
      },
    });

    // Update visibility
    // First, delete existing visibility records
    await prisma.procedureVisibility.deleteMany({
      where: { proc_id: procedureId },
    });

    // Then, create new visibility records
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
        proc_id: procedureId,
        user_type: ut.user_type_id,
      })),
    });

    return {
      success: true,
      statusCode: 200,
      message: "Procedure updated successfully",
      data: {
        proc_id: procedureId,
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

    // Soft delete in SQL
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
      message: "Procedure deleted successfully",
    };
  } catch (error) {
    console.error("deleteProcedure error:", error);
    return {
      success: false,
      statusCode: 500,
      message: "Internal server error",
    };
  }
}
