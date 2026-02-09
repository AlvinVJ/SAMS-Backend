import { deleteProcedure, saveProcedureDef } from '../services/admin.service.js';
import { prisma } from '../db/prisma.js';
import { firestore } from '../config/firebase.js';

async function testSmartDeletion() {
    console.log('--- Starting Smart Deletion Test ---');

    const adminUser = { mits_uid: 'admin_test' };

    // 1. Test case: No requests -> Should be SOFT DELETED (deleted_at set)
    console.log('\nCase 1: No requests...');
    const res1 = await saveProcedureDef({
        headers: {},
        body: { procedure: { title: 'Temp Proc ' + Date.now(), desc: 'No requests test', visibility: ['all'] } },
        user: adminUser
    });
    const proc1Id = res1.data.proc_id;

    await deleteProcedure({ procedureId: proc1Id, user: adminUser });

    const deletedProc = await prisma.procedures.findUnique({ where: { proc_id: proc1Id } });
    console.log(`Proc 1 - is_active: ${deletedProc?.is_active} (Expected: false)`);
    console.log(`Proc 1 - deleted_at: ${deletedProc?.deleted_at} (Expected: NOT null)`);

    // 2. Test case: Has requests -> Should be DEACTIVATED (deleted_at null)
    console.log('\nCase 2: Has requests...');
    const res2 = await saveProcedureDef({
        headers: {},
        body: { procedure: { title: 'Historical Proc ' + Date.now(), desc: 'Has requests test', visibility: ['all'] } },
        user: adminUser
    });
    const proc2Id = res2.data.proc_id;

    // Create a mock request for proc2
    await prisma.requests.create({
        data: {
            req_id: 'req_test_' + Date.now(),
            proc_id: proc2Id,
            created_by: 'student_test',
            status: 0
        }
    });

    await deleteProcedure({ procedureId: proc2Id, user: adminUser });

    const historicalProc = await prisma.procedures.findUnique({ where: { proc_id: proc2Id } });
    console.log(`Proc 2 - is_active: ${historicalProc?.is_active} (Expected: false)`);
    console.log(`Proc 2 - deleted_at: ${historicalProc?.deleted_at} (Expected: null)`);

    console.log('\n--- Test Complete ---');
}

testSmartDeletion().catch(console.error).finally(() => process.exit());
