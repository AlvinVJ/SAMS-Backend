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

/**
 * Hook to handle overnight hosteller notifications.
 * Filters hostellers from a student list and routes them to WARDEN_MH/LH based on gender.
 */
export async function processHostellerNotification(payload: {
    procedureId: string;
    students: any[];
    coordinatorUid: string;
    eventName: string;
    date: string;
}): Promise<Result> {
    try {
        const { students, coordinatorUid, eventName, date, procedureId } = payload;

        // 1. Robust UID Extraction
        const rawUids: string[] = students.map((s: any) => {
            if (typeof s === "string") return s;
            if (typeof s === "object" && s !== null) {
                const uidKey = Object.keys(s).find(k =>
                    k.toLowerCase() === "mits_uid" ||
                    k.toLowerCase() === "mitsuid" ||
                    k.toLowerCase() === "uid" ||
                    k.toLowerCase() === "student_id"
                );
                return uidKey ? s[uidKey] : null;
            }
            return null;
        }).filter(Boolean).map(u => u.toString().trim());

        if (rawUids.length === 0) {
            return { success: false, statusCode: 400, message: "No valid student UIDs found in the list." };
        }

        // 2. Fetch student profiles (Only hostellers)
        const studentProfiles = await prisma.student.findMany({
            where: {
                mits_uid: { in: rawUids },
                hosteller: true
            }
        });

        if (studentProfiles.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: "No hostellers found in the list. No hostel notifications required.",
                data: { createdRequests: [] }
            };
        }

        // 3. Group hostellers by Gender
        const genderGroups: Record<string, {
            roleTag: string,
            students: any[],
            label: string
        }> = {
            "Male": { roleTag: "WARDEN_MH", students: [], label: "Mens Hostel" },
            "Female": { roleTag: "WARDEN_LH", students: [], label: "Ladies Hostel" }
        };

        for (const student of studentProfiles) {
            const gender = student.gender || "Male"; // Default to Male if missing
            if (genderGroups[gender]) {
                genderGroups[gender].students.push({
                    mits_uid: student.mits_uid,
                    name: student.name,
                    gender: student.gender
                });
            }
        }

        // 4. Fetch Coordinator details
        const coordinator = await prisma.faculty.findUnique({
            where: { mits_uid: coordinatorUid },
            include: { Departments: true }
        });
        const coordinatorName = coordinator?.name || "Unknown Coordinator";
        const coordinatorDept = coordinator?.Departments?.dept_name || "N/A";

        const createdRequests = [];

        // 5. Create requests for each hostel group
        for (const [gender, group] of Object.entries(genderGroups)) {
            if (group.students.length === 0) continue;

            // Resolve Wardens
            const wardens = await prisma.roleMapping.findMany({
                where: {
                    Roles: { role_tag: { equals: group.roleTag, mode: 'insensitive' } },
                    is_active: true,
                    deleted_at: null
                },
                select: { mits_uid: true }
            });

            if (wardens.length === 0) {
                console.warn(`[OVERNIGHT_HOSTEL] No active wardens found for ${group.roleTag}`);
                continue;
            }

            const requestId = generateId();
            const nowISO = new Date().toISOString();

            // SQL Entries
            await prisma.requests.create({
                data: {
                    req_id: requestId,
                    proc_id: procedureId,
                    created_by: coordinatorUid,
                    status: 0,
                }
            });

            await prisma.toApprove.createMany({
                data: wardens.map(w => ({
                    req_id: requestId,
                    approverUID: w.mits_uid,
                    approvalLevel: 1,
                    approvalType: group.roleTag
                }))
            });

            // Analytics
            try {
                const wardenRole = await prisma.roles.findUnique({ where: { role_tag: group.roleTag } });
                if (wardenRole) {
                    for (const w of wardens) {
                        await prisma.analytics.upsert({
                            where: { mits_uid_role_id: { mits_uid: w.mits_uid, role_id: wardenRole.role_id } },
                            create: { mits_uid: w.mits_uid, role_id: wardenRole.role_id, pending: 1 },
                            update: { pending: { increment: 1 } }
                        });
                    }
                }
            } catch (e) {
                console.error(`[OVERNIGHT_HOSTEL] Analytics failed for ${requestId}:`, e);
            }

            // Firestore Entry
            await firestore.collection("requests").doc(requestId).set({
                reqId: requestId,
                procId: procedureId,
                type: "HOSTEL_NOTIFICATION",
                isBulk: true,
                eventName: eventName,
                eventDate: date,
                studentId: coordinatorUid,
                studentName: coordinatorName,
                requesterRole: `Event Coordinator (${coordinatorDept})`,
                hostelType: group.label,
                student_list: group.students,
                formData: {
                    event_name: eventName,
                    event_date: date,
                    hostel_type: group.label,
                    student_list: group.students
                },
                current_level: 1,
                status: "PENDING",
                lastLevelRoleTag: group.roleTag,
                createdAt: nowISO,
                updatedAt: nowISO,
                approval_progress: [
                    {
                        level: 1,
                        net_status: "PENDING",
                        required_approvals: 1,
                        decisions: wardens.map(w => ({
                            mits_uid: w.mits_uid,
                            decision: null,
                            timestamp: null,
                            comments: null,
                            role: group.roleTag
                        }))
                    }
                ]
            });

            createdRequests.push({
                requestId,
                hostel: group.label,
                studentCount: group.students.length
            });
        }

        return {
            success: true,
            statusCode: 201,
            message: `Successfully routed hostel notifications for ${createdRequests.length} hostels.`,
            data: { createdRequests }
        };

    } catch (error: any) {
        console.error("processHostellerNotification error:", error);
        return { success: false, statusCode: 500, message: "Internal server error: " + error.message };
    }
}
