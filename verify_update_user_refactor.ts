import { updateUserService } from "./src/services/admin.service.js";
import { prisma } from "./src/db/prisma.js";

async function test() {
    console.log("Testing refactored updateUserService...");

    // Use a faculty we know exists but likely has no UserAccount
    const mits_uid = "abdulali";
    const role_ids = [1]; // Assuming role 1 exists

    console.log(`Attempting to update roles for: ${mits_uid}`);

    const result = await updateUserService({
        mits_uid,
        role_ids
    });

    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.success) {
        console.log("✅ Success: Update successful.");
        const mappings = await prisma.roleMapping.findMany({
            where: { mits_uid, is_active: true },
            include: { Roles: true }
        });
        console.log("Active roles for user:", JSON.stringify(mappings.map(m => m.Roles.role_tag), null, 2));
    } else {
        console.log("❌ Failure: Update failed.");
    }
}

test()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
