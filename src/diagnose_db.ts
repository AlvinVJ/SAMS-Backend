
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnose() {
    console.log("--- DIAGNOSING PROCEDURE VISIBILITY ---");

    const userTypes = await prisma.userTypes.findMany();
    console.log("\nUser Types in DB:");
    console.table(userTypes);

    const procedures = await prisma.procedures.findMany({
        include: {
            ProcedureVisibility: true
        }
    });

    console.log("\nProcedures in DB:");
    const tableData = procedures.map(p => ({
        id: p.proc_id,
        title: p.title,
        active: p.is_active,
        deleted: p.deleted_at,
        visibility: p.ProcedureVisibility.map(v => v.user_type).join(', ')
    }));
    console.table(tableData);

    console.log("\n--- END DIAGNOSIS ---");
}

diagnose()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
