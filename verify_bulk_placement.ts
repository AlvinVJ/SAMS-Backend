import { prisma } from './src/db/prisma.js';
import * as PlacementService from './src/services/placement.service.js';

async function testPlacementBulk() {
    console.log("--- TESTING BOLK PLACEMENT ATTENDANCE ---");

    // 1. Mock student UIDs (assuming these exist in your DB from previous sessions)
    // If they don't exist, this will test the '0 profiles found' case.
    const sampleStudents = [
        { mits_uid: '22CS328' },
        { mits_uid: '22CS461' },
        { mits_uid: '22cs328' }, // Test normalization
    ];

    const payload = {
        procedureId: "PLACEMENT_BULK",
        students: sampleStudents,
        coordinatorUid: "FACULTY001", // Mock coordinator
        eventName: "TCS Ninja Drive",
        date: "2026-03-15"
    };

    console.log("Processing payload...");
    const result = await PlacementService.processPlacementAttendance(payload);

    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.success && result.data.createdRequests.length > 0) {
        for (const req of result.data.createdRequests) {
            console.log(`Checking ToApprove for Request: ${req.requestId}`);
            const approvals = await prisma.toApprove.findMany({
                where: { req_id: req.requestId }
            });
            console.log(`Approvals found: ${approvals.length}`);
            approvals.forEach(a => console.log(` - Approver: ${a.approverUID}, Type: ${a.approvalType}`));

            console.log(`Checking Analytics pending for advisor: ${approvals[0]?.approverUID}`);
            if (approvals[0]) {
                const analytics = await prisma.analytics.findFirst({
                    where: { mits_uid: approvals[0].approverUID }
                });
                console.log(`Analytics Pending: ${analytics?.pending}`);
            }
        }
    } else {
        console.log("No requests were created. This might be because no students or advisors were found in the database for the provided UIDs.");
    }

    console.log("--- TEST END ---");
}

testPlacementBulk()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
