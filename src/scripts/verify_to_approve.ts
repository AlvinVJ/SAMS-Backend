
import { prisma } from "../db/prisma.js";

async function verify() {
    console.log("\n--- TOAPPROVE TABLE STATUS ---");
    try {
        const toApprove = await prisma.toApprove.findMany({
            include: {
                Requests: {
                    select: {
                        req_id: true,
                        proc_id: true,
                        created_at: true,
                        status: true
                    }
                }
            }
        });

        if (toApprove.length === 0) {
            console.log("No pending approvals found in the buffer table.");
        } else {
            const tableData = toApprove.map(item => ({
                request: item.req_id,
                approver: item.approverUID,
                level: item.approvalLevel,
                type: item.approvalType,
                req_status: item.Requests?.status === 0 ? "PENDING" : (item.Requests?.status === 1 ? "APPROVED" : "REJECTED")
            }));
            console.table(tableData);
        }
    } catch (error) {
        console.error("Verification failed:", error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

verify();
