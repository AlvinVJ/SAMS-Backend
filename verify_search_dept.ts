import { searchFacultyService } from "./src/services/admin.service.js";
import { prisma } from "./src/db/prisma.js";

async function test() {
    console.log("Testing searchFacultyService with department filter...");

    const query = "ABDUL";
    const deptId = 1; // CSE in previous tests

    console.log(`Searching for: ${query} in department: ${deptId}`);

    const result = await searchFacultyService(query, deptId);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.success) {
        console.log(`✅ Success: Found ${result.data.length} results.`);
        for (const item of result.data) {
            if (item.Faculty) {
                if (item.Faculty.department_id === deptId) {
                    console.log(`✅ Success: Faculty ${item.mits_uid} belongs to department ${deptId}.`);
                } else {
                    console.log(`❌ Failure: Faculty ${item.mits_uid} belongs to department ${item.Faculty.department_id}, expected ${deptId}.`);
                }
            } else if (item.Student) {
                if (item.Student.Classes.dept_id === deptId) {
                    console.log(`✅ Success: Student ${item.mits_uid} belongs to department ${deptId}.`);
                } else {
                    console.log(`❌ Failure: Student ${item.mits_uid} belongs to department ${item.Student.Classes.dept_id}, expected ${deptId}.`);
                }
            }
        }
    } else {
        console.log("❌ Failure: Search failed.");
    }
}

test()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
