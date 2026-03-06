import { prisma } from "./src/db/prisma.js";

async function main() {
    const batches = await prisma.batches.findMany({
        where: { is_active: true }
    });
    const classes = await prisma.classes.findMany({
        where: { is_active: true },
        include: { Batches: true }
    });

    console.log("Batches:", JSON.stringify(batches, null, 2));
    console.log("Classes:", JSON.stringify(classes.map(c => ({
        class_id: c.class_id,
        class: c.class,
        batch: c.Batches?.batch
    })), null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
