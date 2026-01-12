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