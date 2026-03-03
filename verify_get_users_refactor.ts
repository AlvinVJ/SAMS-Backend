import { getUsersService } from "./src/services/admin.service.js";
import { prisma } from "./src/db/prisma.js";

async function test() {
    console.log("Testing refactored getUsersService...");

    // Search for a name that we know exists in Faculty but might not have a UserAccount
    const search = "ABDUL";
    console.log(`Searching for: ${search}`);

    const result = await getUsersService(search);
    console.log("Result length:", result.data?.length);

    if (result.success && result.data.length > 0) {
        const first = result.data[0];
        console.log("First result sample:", JSON.stringify({
            mits_uid: first.mits_uid,
            name: first.name,
            UserTypes: first.UserTypes,
            hasAccount: !!first.auth_uid
        }, null, 2));
        console.log("✅ Success: Found matching user.");
    } else {
        console.log("❌ Failure: No matches found.");
    }
}

test()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
