import { prisma } from "./src/db/prisma.js";

async function main() {
    const roles = await prisma.roles.findMany({
        select: { role_tag: true, role_desc: true }
    });
    console.log("Roles in DB:", JSON.stringify(roles, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
