
import { PrismaClient } from '../generated/client.js';

const prisma = new PrismaClient();

async function getSampleData() {
    console.log("--- FETCHING SAMPLE STUDENT DATA FOR PLACEMENT TEST ---");

    // Get students with their class and class advisor
    const students = await prisma.student.findMany({
        take: 10,
        include: {
            Classes: {
                include: {
                    ClassFaculty: {
                        where: { is_active: true, role_tag: 'CLASS_ADVISOR' },
                        include: { Faculty: true }
                    }
                }
            }
        }
    });

    console.log("\nStudent Samples:");
    const tableData = students.map(s => ({
        uid: s.mits_uid,
        class: s.Classes?.class,
        advisor: s.Classes?.ClassFaculty?.[0]?.Faculty?.mits_uid || 'NONE'
    }));
    console.table(tableData);

    console.log("\n--- END ---");
}

getSampleData()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
