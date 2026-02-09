import { updateProcedure } from '../services/admin.service.js';
import { prisma } from '../db/prisma.js';
import { firestore } from '../config/firebase.js';

async function testVersioning() {
    console.log('--- Starting Procedure Versioning Test ---');

    // 1. Setup: Find an active procedure
    const procedure = await prisma.procedures.findFirst({
        where: { is_active: true }
    });

    if (!procedure) {
        console.error('No active procedure found to test with.');
        return;
    }

    console.log(`Found procedure: ${procedure.title} (${procedure.proc_id})`);

    // 2. Simulate Update
    const mockPayload = {
        procedureId: procedure.proc_id,
        body: {
            procedure: {
                title: procedure.title + ' (Updated)',
                desc: 'Testing versioning logic',
                formFields: [],
                approvalLevels: [],
                visibility: ['all']
            }
        },
        user: { mits_uid: procedure.created_by || 'admin_test' }
    };

    console.log('Updating procedure...');
    const result = await updateProcedure(mockPayload);

    if (!result.success) {
        console.error('Update failed:', result.message);
        return;
    }

    const newId = result.data.proc_id;
    console.log(`Update successful! New ID: ${newId}`);

    // 3. Verify Old is Inactive
    const oldProc = await prisma.procedures.findUnique({
        where: { proc_id: procedure.proc_id }
    });
    console.log(`Old procedure is_active: ${oldProc?.is_active} (Expected: false)`);

    const oldDoc = await firestore.collection('procedures').doc(procedure.proc_id).get();
    console.log(`Old Firestore doc is_active: ${oldDoc.data()?.is_active} (Expected: false)`);

    // 4. Verify New is Active
    const newProc = await prisma.procedures.findUnique({
        where: { proc_id: newId }
    });
    console.log(`New procedure is_active: ${newProc?.is_active} (Expected: true)`);
    console.log(`New procedure title: ${newProc?.title}`);

    console.log('--- Test Complete ---');
}

testVersioning().catch(console.error).finally(() => process.exit());
