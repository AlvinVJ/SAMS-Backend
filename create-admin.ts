import { prisma } from "./src/db/prisma.js";
import readline from "readline";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
    console.log("--- Admin Account Setup ---\n");

    try {
        // 1. Fetch Departments
        const departments = await prisma.departments.findMany({
            where: { is_active: true },
            orderBy: { dept_name: 'asc' }
        });

        if (departments.length === 0) {
            console.error("❌ No active departments found in database. Please seed departments first.");
            process.exit(1);
        }

        // 2. Collect Information
        const email = await question("Enter Email: ");
        if (!email || !email.includes("@")) {
            console.error("❌ Valid email is required.");
            process.exit(1);
        }

        const name = await question("Enter Full Name: ");
        if (!name) {
            console.error("❌ Name is required.");
            process.exit(1);
        }

        console.log("\nAvailable Departments:");
        departments.forEach(d => console.log(`${d.dept_id}: ${d.dept_name}`));

        const deptIdInput = await question("\nEnter Department ID: ");
        const deptId = parseInt(deptIdInput);
        const selectedDept = departments.find(d => d.dept_id === deptId);

        if (!selectedDept) {
            console.error("❌ Invalid Department ID.");
            process.exit(1);
        }

        const normalizedEmail = email.trim().toLowerCase();
        const mits_uid = normalizedEmail.split('@')[0];

        console.log("\nCreating account...");

        await prisma.$transaction(async (tx) => {
            // 3. Upsert Faculty
            await tx.faculty.upsert({
                where: { mits_uid: mits_uid },
                update: {
                    name: name,
                    department_id: deptId,
                    email: normalizedEmail,
                    is_active: true
                },
                create: {
                    mits_uid: mits_uid,
                    name: name,
                    department_id: deptId,
                    email: normalizedEmail,
                    is_active: true
                }
            });

            // 4. Upsert UserAccount
            await tx.userAccount.upsert({
                where: { email: normalizedEmail },
                update: {
                    user_type: 2, // ADMIN
                    mits_uid: mits_uid,
                    is_active: true
                },
                create: {
                    mits_uid: mits_uid,
                    email: normalizedEmail,
                    user_type: 2, // ADMIN
                    auth_uid: `admin_${mits_uid}_${Date.now()}`,
                    is_active: true
                }
            });
        });

        console.log(`\n✅ Success! Admin account and Faculty profile created/updated.`);
        console.log(`Email: ${normalizedEmail}`);
        console.log(`Name: ${name}`);
        console.log(`Department: ${selectedDept.dept_name}`);
        console.log(`MITS UID: ${mits_uid}`);

    } catch (error) {
        console.error("\n❌ Error:", error);
    } finally {
        rl.close();
        await prisma.$disconnect();
    }
}

main();
