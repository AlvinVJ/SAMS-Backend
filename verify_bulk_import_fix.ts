import { bulkImportUsersService } from "./src/services/admin.service.js";
import { prisma } from "./src/db/prisma.js";

async function test() {
    console.log("Testing refactored bulkImportUsersService with user's data...");

    // User's specific row with "Batch " and "Email " (notice the trailing spaces)
    const userData = [
        {
            "mits_uid": "22cs461",
            "Name": "Ashmitha",
            "Batch ": "2022-2026",
            "Class": "CSE A",
            "Email ": "22cs461@mgits.ac.in",
            "Gender": "F",
            "Hosteller": "TRUE",
            "Phone": "8714382654"
        }
    ];

    console.log("Input data keys:", Object.keys(userData[0]));

    const result = await bulkImportUsersService({
        users: userData,
        defaultUserType: "STUDENT"
    });

    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.success) {
        console.log("✅ Success: Import successful.");
        const student = await prisma.student.findUnique({
            where: { mits_uid: "22cs461" },
            include: { Batches: true, Classes: true }
        });
        console.log("Student in DB:", JSON.stringify(student, null, 2));
    } else {
        console.log("❌ Failure: Import failed.");
    }
}

test()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
