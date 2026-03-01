import { prisma } from './src/db/prisma.js';

async function main() {
    const uids = ['22CS461', '22CS328', '22cs461', '22cs328'];
    const students = await prisma.student.findMany({
        where: { mits_uid: { in: uids, mode: 'insensitive' } },
        include: {
            Classes: {
                include: { Departments: true }
            },
            Batches: true
        }
    });

    console.log(JSON.stringify(students, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
