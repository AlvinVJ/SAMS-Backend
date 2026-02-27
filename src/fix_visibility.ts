
import { PrismaClient } from '../generated/client.js';

const prisma = new PrismaClient();

async function fixVisibility() {
    console.log("--- FIXING MISSING VISIBILITY RECORDS ---");

    // Find procedures with NO visibility
    const procedures = await prisma.procedures.findMany({
        where: { is_active: true },
        include: { ProcedureVisibility: true }
    });

    for (const proc of procedures) {
        if (proc.ProcedureVisibility.length === 0) {
            console.log(`Fixing visibility for: ${proc.title}`);

            if (proc.title.includes("Placement")) {
                // Assign to Placement Coordinator (4) and Faculty (1)
                await prisma.procedureVisibility.createMany({
                    data: [
                        { proc_id: proc.proc_id, user_type: 4 },
                        { proc_id: proc.proc_id, user_type: 1 }
                    ]
                });
                console.log(`-> Assigned to Placement Coordinator & Faculty`);
            } else {
                // Default to all? Or just Faculty?
                await prisma.procedureVisibility.create({
                    data: { proc_id: proc.proc_id, user_type: 1 }
                });
                console.log(`-> Assigned to Faculty by default`);
            }
        }
    }

    console.log("\n--- DONE ---");
}

fixVisibility()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
