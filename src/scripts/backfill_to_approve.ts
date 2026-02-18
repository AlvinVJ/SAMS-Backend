
import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";

async function resolveApproversForRole(roleTag: string, requesterUid: string): Promise<string[]> {
    const normalizedTag = roleTag.toLowerCase();

    if (normalizedTag === "class_advisor") {
        const student = await prisma.student.findUnique({
            where: { mits_uid: requesterUid },
            select: { class_id: true },
        });
        if (!student || !student.class_id) return [];

        const advisors = await prisma.classFaculty.findMany({
            where: {
                class_id: student.class_id,
                role_tag: { equals: "class_advisor", mode: 'insensitive' },
                is_active: true,
                deleted_at: null,
            },
            select: { mits_uid: true },
        });
        return advisors.map(a => a.mits_uid);
    }

    const role = await prisma.roles.findFirst({
        where: { role_tag: { equals: normalizedTag, mode: 'insensitive' } },
        select: { role_id: true },
    });
    if (!role) return [];

    const mappings = await prisma.roleMapping.findMany({
        where: { role_id: role.role_id, is_active: true, deleted_at: null },
        select: { mits_uid: true },
    });
    return mappings.map(m => m.mits_uid);
}

async function backfill() {
    console.log("Starting Backfill for ToApprove table...");

    try {
        const requestsSnap = await firestore.collection("requests").where("status", "==", "PENDING").get();
        console.log(`Found ${requestsSnap.size} pending requests in Firestore.`);

        let totalEntriesCreated = 0;

        for (const doc of requestsSnap.docs) {
            const data = doc.data();
            const requestId = doc.id;

            // Exhaustive field name checks for legacy data support
            const procId = data.procId || data.proc_id || data.procedure_id || data.procedureId;
            const currentLevel = data.current_level || data.currentLevel || 1;
            const studentId = data.studentId || data.student_id || data.studentUID;

            if (!procId) {
                console.log(`Skipping Request ${requestId}: Missing procId (keys present: ${Object.keys(data).join(', ')})`);
                continue;
            }

            console.log(`Processing Request ${requestId} (Level ${currentLevel}, Proc ${procId})...`);

            const progress = data.approval_progress || data.approvalProgress || [];
            const levelBlock = progress.find((lvl: any) => lvl.level === currentLevel);

            if (!levelBlock || levelBlock.net_status !== "PENDING") {
                console.log(`Skipping Request ${requestId}: No pending level block found for level ${currentLevel}. (Progress keys: ${Object.keys(progress?.[0] || {}).join(', ')})`);
                continue;
            }

            // Identify approvers who haven't acted yet at this level
            const pendingApprovers = levelBlock.decisions
                .filter((d: any) => !d.decision)
                .map((d: any) => d.mits_uid)
                .filter(Boolean); // Ensure UIDs are not null

            if (pendingApprovers.length === 0) {
                console.log(`Skipping Request ${requestId}: No pending approvers at current level.`);
                continue;
            }

            // Try to determine the role for these approvers for the approvalType field
            const procDoc = await firestore.collection("procedures").doc(procId).get();
            const procedureDef = procDoc.exists ? procDoc.data() : null;
            const levelDef = procedureDef?.approvalLevels?.find((l: any) => l.level === currentLevel);
            const roleTag = (levelDef?.roleIds || [levelDef?.role])?.[0] || "Approver";

            const toApproveData = pendingApprovers.map((uid: string) => ({
                req_id: requestId,
                approverUID: uid,
                approvalLevel: currentLevel,
                approvalType: roleTag
            }));

            for (const entry of toApproveData) {
                try {
                    await prisma.toApprove.upsert({
                        where: {
                            req_id_approverUID: {
                                req_id: entry.req_id,
                                approverUID: entry.approverUID
                            }
                        },
                        create: entry,
                        update: entry
                    });
                    totalEntriesCreated++;
                } catch (err: any) {
                    console.error(`Failed to upsert entry for req ${requestId}, user ${entry.approverUID}:`, err.message);
                }
            }
        }

        console.log(`Backfill completed. Total entries processed: ${totalEntriesCreated}`);
    } catch (error: any) {
        console.error("Backfill failed:", error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

backfill();
