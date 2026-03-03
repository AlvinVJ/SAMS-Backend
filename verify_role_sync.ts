import { assignDepartmentRole, removeDepartmentRole } from "./src/services/admin.service.js";
import { prisma } from "./src/db/prisma.js";

async function test() {
    console.log("Testing RoleMapping sync in Department Role functions...");

    const dept_id = 1;
    const mits_uid = "abdulali";
    const role_tag = "HOD";

    console.log(`Assigning ${role_tag} to ${mits_uid} in department ${dept_id}...`);

    const assignResult = await assignDepartmentRole({
        dept_id,
        mits_uid,
        role_tag
    });

    console.log("Assign Result:", JSON.stringify(assignResult, null, 2));

    if (assignResult.success) {
        const roleMapping = await prisma.roleMapping.findFirst({
            where: { mits_uid, is_active: true },
            include: { Roles: true }
        });
        console.log("Global roles for user after assignment:", roleMapping?.Roles.role_tag);
        if (roleMapping?.Roles.role_tag === "HOD") {
            console.log("✅ Success: RoleMapping updated correctly.");
        } else {
            console.log("❌ Failure: RoleMapping NOT updated correctly.");
        }
    }

    console.log(`\nRemoving role for ${mits_uid}...`);
    const removeResult = await removeDepartmentRole({ mits_uid });
    console.log("Remove Result:", JSON.stringify(removeResult, null, 2));

    if (removeResult.success) {
        const roleMappingAfter = await prisma.roleMapping.findFirst({
            where: { mits_uid, is_active: true },
        });
        if (!roleMappingAfter) {
            console.log("✅ Success: RoleMapping deactivated correctly.");
        } else {
            console.log("❌ Failure: RoleMapping still active.");
        }
    }
}

test()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
