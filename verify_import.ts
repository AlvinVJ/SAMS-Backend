import { prisma } from './src/db/prisma.js';

async function checkStudents() {
    const users = await prisma.userAccount.findMany({
        where: {
            mits_uid: {
                in: ['2024CS101', '2024CS102']
            }
        },
        include: {
            Student: true,
            RoleMapping: {
                include: {
                    Roles: true
                }
            }
        }
    });

    console.log(JSON.stringify(users, null, 2));
}

checkStudents()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
