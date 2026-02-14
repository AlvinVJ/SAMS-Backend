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
    students: { mits_uid: string }[];
    coordinatorUid: string;
    eventName: string;
    date: string;
}): Promise<Result> {
    try {
        const { students, coordinatorUid, eventName, date, procedureId } = payload;

        // 1. Fetch student profiles to group by class
        const uids = students.map(s => s.mits_uid);
        const studentProfiles = await prisma.student.findMany({
            where: { mits_uid: { in: uids } },
            include: {
                Classes: {
                    include: { Departments: true }
                }
            }
        });

        // 2. Group students by class_id
        const classGroups: Record<number, any[]> = {};
        for (const student of studentProfiles) {
            const classId = student.class_id;
            if (!classGroups[classId]) {
                classGroups[classId] = [];
            }
            classGroups[classId]!.push({
                mits_uid: student.mits_uid,
                name: student.name
            });
        }

        const createdRequests = [];

        // 3. For each class, find advisor and create a bulk request
        for (const [classIdStr, classStudents] of Object.entries(classGroups)) {
            const classId = Number(classIdStr);

            // Find Class Advisors
            const advisors = await prisma.classFaculty.findMany({
                where: {
                    class_id: classId,
                    role_tag: { equals: "class_advisor", mode: 'insensitive' },
                    is_active: true
                }
            });

            if (advisors.length === 0) {
                console.warn(`No advisor found for class_id ${classId}`);
                continue;
            }

            const requestId = generateId();
            const nowISO = new Date().toISOString();
            const firstAdvisor = advisors[0];
            const studentProfile = studentProfiles.find(s => s.class_id === classId);
            const className = studentProfile?.Classes.class || "Unknown Class";

            // Create SQL Request entry
            // Note: We create one request per class advisor for now, or one request tracked by advisors
            await prisma.requests.create({
                data: {
                    req_id: requestId,
                    proc_id: procedureId, // Use actual proc_id
                    created_by: coordinatorUid,
                    status: 0,
                }
            });

            // Create Firestore Request entry
            await firestore.collection("requests").doc(requestId).set({
                reqId: requestId,
                procId: procedureId, // Use actual proc_id
                type: "PLACEMENT_ATTENDANCE",
                isBulk: true,
                eventName: eventName,
                eventDate: date,
                className: className,
                students: classStudents,
                current_level: 1,
                status: "PENDING",
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
                            comments: null
                        }))
                    }
                ]
            });

            createdRequests.push({
                requestId,
                className,
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
