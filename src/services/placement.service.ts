import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";
import admin from "../config/firebase.js";

interface Result {
    success: boolean;
    statusCode: number;
    message: string;
    data?: any;
}

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

export async function processPlacementAttendance(payload: {
    procedureId: string;
    students: any[]; // Changed to any[] for robustness
    coordinatorUid: string;
    eventName: string;
    date: string;
}): Promise<Result> {
    try {
        const { students, coordinatorUid, eventName, date, procedureId } = payload;

        // 1. Robust UID Extraction
        const rawUids: string[] = students.map((s: any) => {
            if (typeof s === 'string') return s;
            if (typeof s === 'object' && s !== null) {
                // Search for UID in object properties (case-insensitive)
                const uidKey = Object.keys(s).find(k =>
                    k.toLowerCase() === 'mits_uid' ||
                    k.toLowerCase() === 'mitsuid' ||
                    k.toLowerCase() === 'uid' ||
                    k.toLowerCase() === 'student_id'
                );
                return uidKey ? s[uidKey] : null;
            }
            return null;
        }).filter(Boolean).map(u => u.toString().trim());

        if (rawUids.length === 0) {
            console.warn(`[PLACEMENT_BULK] No valid UIDs extracted from students array of length ${students.length}.`);
            console.log(`[PLACEMENT_BULK] First item sample:`, students[0]);
        }

        // Generate both lowercase and uppercase variants for the database query
        // This ensures matches regardless of how UIDs are stored in PG
        const searchUids = [...new Set([
            ...rawUids.map(u => u.toLowerCase()),
            ...rawUids.map(u => u.toUpperCase())
        ])];

        // 2. Fetch student profiles from SQL
        const studentProfiles = await prisma.student.findMany({
            where: {
                mits_uid: {
                    in: searchUids,
                }
            },
            include: {
                Classes: {
                    include: { Departments: true }
                },
                Batches: true
            }
        });

        console.log(`[PLACEMENT_BULK] Found ${studentProfiles.length} profiles for ${rawUids.length} unique extracted UIDs.`);
        if (studentProfiles.length < rawUids.length) {
            const foundUids = new Set(studentProfiles.map(p => p.mits_uid.toLowerCase()));
            const missingUids = rawUids.filter(u => !foundUids.has(u));
            console.log(`[PLACEMENT_BULK] Missing UIDs in DB:`, missingUids.slice(0, 10));
        }

        // 2. Group students by class_id
        const classGroups: Record<number, {
            students: any[],
            className: string,
            batchName: string
        }> = {};

        for (const student of studentProfiles) {
            const classId = student.class_id;
            if (!classGroups[classId]) {
                classGroups[classId] = {
                    students: [],
                    className: student.Classes?.class || "Unknown Class",
                    batchName: student.Batches?.batch || "Unknown Batch"
                };
            }
            classGroups[classId]!.students.push({
                mits_uid: student.mits_uid,
                name: student.name,
                gender: student.gender || "N/A"
            });
        }

        // 3. Fetch Coordinator details for display
        const coordinator = await prisma.faculty.findUnique({
            where: { mits_uid: coordinatorUid },
            include: { Departments: true }
        });
        const coordinatorName = coordinator?.name || "Unknown Coordinator";
        const coordinatorDept = coordinator?.Departments?.dept_name || "N/A";

        const createdRequests = [];

        // 4. For each class group, create a request for their class advisors
        for (const [classIdStr, group] of Object.entries(classGroups)) {
            const classId = Number(classIdStr);
            const { students: classStudents, className, batchName } = group;

            // Find Class Advisors
            const advisors = await prisma.classFaculty.findMany({
                where: {
                    class_id: classId,
                    role_tag: { equals: "class_advisor", mode: 'insensitive' },
                    is_active: true
                }
            });

            if (advisors.length === 0) {
                console.warn(`[PLACEMENT_BULK] No active advisor found for class_id ${classId} (${className})`);
                continue;
            }

            const requestId = generateId();
            const nowISO = new Date().toISOString();

            // Create SQL Request entry
            await prisma.requests.create({
                data: {
                    req_id: requestId,
                    proc_id: procedureId,
                    created_by: coordinatorUid,
                    status: 0,
                }
            });

            // Populate ToApprove table for all advisors
            await prisma.toApprove.createMany({
                data: advisors.map(a => ({
                    req_id: requestId,
                    approverUID: a.mits_uid,
                    approvalLevel: 1,
                    approvalType: "CLASS_ADVISOR"
                }))
            });

            // Update Analytics pending counts
            try {
                const advisorRole = await prisma.roles.findUnique({ where: { role_tag: "CLASS_ADVISOR" } });
                if (advisorRole) {
                    for (const a of advisors) {
                        await prisma.analytics.upsert({
                            where: { mits_uid_role_id: { mits_uid: a.mits_uid, role_id: advisorRole.role_id } },
                            create: { mits_uid: a.mits_uid, role_id: advisorRole.role_id, pending: 1 },
                            update: { pending: { increment: 1 } }
                        });
                    }
                }
            } catch (err) {
                console.error(`[PLACEMENT_BULK] Analytics update failed for request ${requestId}:`, err);
            }

            // Create Firestore Request entry
            await firestore.collection("requests").doc(requestId).set({
                reqId: requestId,
                procId: procedureId,
                type: "PLACEMENT_ATTENDANCE",
                isBulk: true,
                companyName: eventName,
                testDate: date,
                studentId: coordinatorUid, // Frontend often uses studentId for requester
                studentName: coordinatorName, // Matches requests.service.enrichment
                requesterRole: `Placement Coordinator (${coordinatorDept})`,
                className: `${className} (${batchName})`,
                student_list: classStudents, // Key used by PDF generator
                formData: {
                    company_name: eventName,
                    test_date: date,
                    class_name: className,
                    batch_name: batchName,
                    student_list: classStudents
                },
                current_level: 1,
                status: "PENDING",
                lastLevelRoleTag: "Class Advisor", // The only level in this bulk process
                createdAt: nowISO,
                updatedAt: nowISO,
                approval_progress: [
                    {
                        level: 1,
                        net_status: "PENDING",
                        required_approvals: 1,
                        decisions: advisors.map(a => ({
                            mits_uid: a.mits_uid,
                            decision: null,
                            timestamp: null,
                            comments: null,
                            role: "CLASS_ADVISOR"
                        }))
                    }
                ]
            });

            createdRequests.push({
                requestId,
                className: `${className} (${batchName})`,
                advisorCount: advisors.length,
                studentCount: classStudents.length
            });
        }

        return {
            success: true,
            statusCode: 201,
            message: `Successfully routed placement attendance to ${createdRequests.length} classes.`,
            data: { createdRequests }
        };
    } catch (error: any) {
        console.error("processPlacementAttendance error:", error);
        return { success: false, statusCode: 500, message: "Internal server error: " + error.message };
    }
}
