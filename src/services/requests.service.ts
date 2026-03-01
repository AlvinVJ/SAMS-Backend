import { prisma } from "../db/prisma.js";
import admin, { firestore } from "../config/firebase.js";
import { publishRequestWithdrawn } from "../queues/producers/importantProducer.js";

interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// Helper: Resolve Name from UID
export async function getUserNameFromUid(uid: string): Promise<string> {
  const account = await prisma.userAccount.findUnique({
    where: { mits_uid: uid },
    include: { Faculty: true, Student: true },
  });
  if (account?.Faculty?.name) return account.Faculty.name;
  if (account?.Student?.name) return account.Student.name;
  return "Unknown User";
}

// Helper: Resolve Status Text and Color
export async function resolveRequestStatus(req: any, procData: any, currentLevel: number): Promise<{ text: string, color: string }> {
  if (req.status === 1) return { text: "Approved", color: "success" };
  if (req.status === 2) return { text: "Rejected", color: "error" };
  if (req.status === 3) return { text: "Withdrawn", color: "withdrawn" };

  const activeLevel = procData?.approvalLevels?.find((l: any) => l.level === currentLevel);
  const roleName = (activeLevel?.role || activeLevel?.roleIds?.[0] || "Approver").replaceAll('_', ' ').toUpperCase();
  return { text: `Pending ${roleName}`, color: "warning" };
}

// Helper: Resolve Approvers
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

export async function enrichStudentListInFormData(formData: any, procedureDef: any, selectedRole?: string) {
  if (!formData) return formData;

  for (const key of Object.keys(formData)) {
    let value = formData[key];
    if (!Array.isArray(value) || value.length === 0) continue;

    // Detection: Is this a student list? 
    const isMapList = typeof value[0] === 'object' && value[0] !== null;
    const isStringList = typeof value[0] === 'string';

    if (isMapList || isStringList) {
      let uidKey = '';
      if (isMapList) {
        // Robust check for various UID keys
        const first = value[0];
        const keys = Object.keys(first).map(k => k.toLowerCase());
        if (keys.includes('mits_uid')) uidKey = Object.keys(first).find(k => k.toLowerCase() === 'mits_uid')!;
        else if (keys.includes('mitsuid')) uidKey = Object.keys(first).find(k => k.toLowerCase() === 'mitsuid')!;
        else if (keys.includes('uid')) uidKey = Object.keys(first).find(k => k.toLowerCase() === 'uid')!;
        else if (keys.includes('mits_id')) uidKey = Object.keys(first).find(k => k.toLowerCase() === 'mits_id')!;
        else if (keys.includes('mitsid')) uidKey = Object.keys(first).find(k => k.toLowerCase() === 'mitsid')!;

        if (!uidKey) {
          console.log(`[DEBUG] Key "${key}" looks like list of maps but no UID key found in first item:`, first);
          continue;
        }
      }

      const rawUids = value.map((s: any) => (isStringList ? s : s[uidKey])?.toString().trim()).filter(Boolean);
      if (rawUids.length === 0) continue;

      console.log(`[DEBUG] Found student list in field "${key}" (${isMapList ? 'Maps' : 'Strings'}) with ${rawUids.length} UIDs.`);

      // Prisma 'in' doesn't support 'mode: insensitive', so we normalize if possible or just use multiple query checks
      // Usually UIDs are uppercase in SAMS system. 
      const studentDetails = await prisma.student.findMany({
        where: { mits_uid: { in: rawUids } },
        select: { mits_uid: true, name: true, gender: true }
      });

      // Try once more with lowercased UIDs if nothing found (safety search)
      if (studentDetails.length === 0) {
        const lowerUids = rawUids.map(u => u.toLowerCase());
        const upperUids = rawUids.map(u => u.toUpperCase());
        const compositeUids = [...new Set([...rawUids, ...lowerUids, ...upperUids])];

        const retryDetails = await prisma.student.findMany({
          where: { mits_uid: { in: compositeUids } },
          select: { mits_uid: true, name: true, gender: true }
        });
        studentDetails.push(...retryDetails);
      }

      console.log(`[DEBUG] Prisma found ${studentDetails.length} matching students for list in "${key}".`);

      const studentMap = new Map();
      studentDetails.forEach(s => {
        studentMap.set(s.mits_uid.toLowerCase().trim(), s);
      });

      let enrichedList = value.map((s: any) => {
        const rawUid = (isStringList ? s : s[uidKey])?.toString().trim();
        const uid = rawUid?.toLowerCase();
        const details = studentMap.get(uid);

        // NORMALIZATION: Must return a Map with 'name' and 'gender' for the frontend
        const baseObj = isMapList ? { ...s } : {};
        return {
          ...baseObj,
          mits_uid: rawUid,
          name: details?.name || `!!! NOT_IN_SQL:${rawUid} !!!`,
          gender: details?.gender || "NA"
        };
      });

      // Filter based on Warden role only if it's a Hosteller procedure
      if (procedureDef?.is_hosteller || procedureDef?.isHosteller) {
        if (selectedRole === 'warden_boys') {
          enrichedList = enrichedList.filter(s => s.gender?.toLowerCase() === 'male' || s.gender?.toLowerCase() === 'm' || s.gender?.toLowerCase() === 'b');
        } else if (selectedRole === 'warden_girls') {
          enrichedList = enrichedList.filter(s => s.gender?.toLowerCase() === 'female' || s.gender?.toLowerCase() === 'f' || s.gender?.toLowerCase() === 'g');
        }
      }

      formData[key] = enrichedList;
    }
  }
  return formData;
}

export async function createRequest(payload: { body: any; user: any }): Promise<Result> {
  try {
    const { procedureId, formData } = payload.body;
    const { uid, email, name: tokenName } = payload.user;
    const procedure = await prisma.procedures.findUnique({ where: { proc_id: procedureId } });
    if (!procedure || !procedure.is_active) {
      return { success: false, statusCode: 404, message: "Procedure not found" };
    }
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: uid } });
    if (!userAccount) {
      return { success: false, statusCode: 404, message: "User account not linked" };
    }
    const student = await prisma.student.findUnique({ where: { mits_uid: userAccount.mits_uid } });
    const studentName = student?.name || tokenName || email || "Student";
    const procDoc = await firestore.collection("procedures").doc(procedureId).get();
    let approvalLevelsDefinition = procDoc.exists ? (procDoc.data()?.approvalLevels || []) : [];

    const requestId = generateId();
    const nowISO = new Date().toISOString();
    let approval_progress = [];

    const level1Def = approvalLevelsDefinition.find((l: any) => l.level === 1);
    let toApproveData: any[] = [];

    if (level1Def) {
      let level1Approvers: string[] = [];
      const roleTags = level1Def.roleIds || [level1Def.role];

      for (const tag of roleTags) {
        if (typeof tag === 'string') {
          const uids = await resolveApproversForRole(tag, userAccount.mits_uid);
          level1Approvers.push(...uids);
        }
      }
      level1Approvers = [...new Set(level1Approvers)];
      approval_progress.push({
        level: 1,
        net_status: "PENDING",
        required_approvals: level1Def.allMustApprove ? level1Approvers.length : (level1Def.minApprovals || 1),
        decisions: level1Approvers.map(uid => ({
          mits_uid: uid,
          decision: null,
          timestamp: null,
          comments: null
        }))
      });

      // Prepare ToApprove buffer data
      toApproveData = level1Approvers.map(uid => ({
        req_id: requestId,
        approverUID: uid,
        approvalLevel: 1,
        approvalType: (level1Def.roleIds || [level1Def.role])?.[0] || "Approver"
      }));
    }

    // 1. Create SQL Request record FIRST (to satisfy foreign key in ToApprove)
    await prisma.requests.create({
      data: {
        req_id: requestId,
        proc_id: procedureId,
        created_by: userAccount.mits_uid,
        status: 0,
      },
    });

    // 2. Populate ToApprove buffer table in SQL and update Analytics
    if (toApproveData.length > 0) {
      await prisma.toApprove.createMany({
        data: toApproveData,
        skipDuplicates: true
      });

      // Update Analytics pending count
      try {
        const firstLevelRole = (level1Def.roleIds || [level1Def.role])?.[0];
        if (firstLevelRole) {
          const roleRow = await prisma.roles.findFirst({
            where: { role_tag: { equals: firstLevelRole, mode: 'insensitive' } }
          });
          if (roleRow) {
            for (const approver of toApproveData) {
              await prisma.analytics.upsert({
                where: { mits_uid_role_id: { mits_uid: approver.approverUID, role_id: roleRow.role_id } },
                create: { mits_uid: approver.approverUID, role_id: roleRow.role_id, pending: 1, approved: 0, rejected: 0 },
                update: { pending: { increment: 1 } }
              });
            }
          }
        }
      } catch (e) {
        console.error("Analytics pending update failed in requests.service:", e);
      }
    }

    // 3. Create Firestore record
    await firestore.collection("requests").doc(requestId).set({
      reqId: requestId,
      procId: procedureId,
      studentId: userAccount.mits_uid,
      authUid: uid,
      studentName: studentName,
      studentEmail: email || "",
      status: "PENDING",
      current_level: 1,
      totalLevels: approvalLevelsDefinition.length,
      createdAt: nowISO,
      updatedAt: nowISO,
      last_updated_at: nowISO,
      formData: formData,
      timeline: [{ action: "SUBMITTED", by: studentName, role: "STUDENT", timestamp: nowISO }],
      approval_progress: approval_progress
    });
    return { success: true, statusCode: 201, message: "Request created", data: { requestId } };
  } catch (error: any) {
    console.error("createRequest error:", error);
    return { success: false, statusCode: 500, message: "Internal server error: " + error.message };
  }
}

export async function getMyRequests(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "User not found" };

    const requests = await prisma.requests.findMany({
      where: { created_by: userAccount.mits_uid },
      include: { Procedures: true },
      orderBy: { created_at: 'desc' }
    });

    const formatted = [];

    for (const req of requests) {
      const userData = await prisma.userAccount.findUnique({
        where: { mits_uid: req.created_by },
        include: { Student: { include: { Classes: { include: { Departments: true } } } } }
      });

      formatted.push({
        req_id: req.req_id,
        procedure_title: req.Procedures?.title || "Unknown Request",
        created_at: req.created_at,
        status: req.status,
        status_text: req.status === 1 ? "Approved" : (req.status === 2 ? "Rejected" : (req.status === 3 ? "Withdrawn" : "Pending")),
        color: req.status === 1 ? "success" : (req.status === 2 ? "error" : (req.status === 3 ? "withdrawn" : "warning")),
        studentName: userData?.Student?.name || "Unknown",
        studentId: req.created_by,
        department: userData?.Student?.Classes?.Departments?.dept_name || "N/A",
        is_resolved: false,
      });
    }

    return { success: true, statusCode: 200, message: "Requests fetched", data: formatted };
  } catch (error) {
    console.error("getMyRequests error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getRequestDetails(requestId: string): Promise<Result> {
  try {
    const req = await prisma.requests.findUnique({
      where: { req_id: requestId },
      include: { Procedures: true },
    });

    if (!req) return { success: false, statusCode: 404, message: "Request not found" };

    const snap = await firestore.collection("requests").doc(requestId).get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request detail not found in Firestore" };

    const data = snap.data()!;
    const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
    const procData = procDoc.exists ? procDoc.data() : null;

    const current_level = data.current_level || 1;
    const total_levels = procData?.approvalLevels?.length || 1;

    const { text: status_text, color } = await resolveRequestStatus(req, procData, current_level);

    const approvalHistory = [];
    const historyBlocks = (data.approval_progress || []);
    for (const block of historyBlocks) {
      const levelDefHistory = procData?.approvalLevels?.find((l: any) => l.level === block.level);
      const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
      for (const decision of block.decisions) {
        if (decision.decision) {
          approvalHistory.push({
            level: block.level,
            approverName: await getUserNameFromUid(decision.mits_uid),
            role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
            status: decision.decision,
            comments: decision.comments,
            timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
          });
        }
      }
    }

    const userData = await prisma.userAccount.findUnique({
      where: { mits_uid: req.created_by },
      include: { Student: { include: { Classes: { include: { Departments: true } } } } }
    });

    const lastLevel = (procData as any)?.approvalLevels?.length > 0
      ? (procData as any).approvalLevels[(procData as any).approvalLevels.length - 1]
      : null;
    const lastLevelRoleTag = lastLevel?.role || lastLevel?.roleIds?.[0] || "Approver";

    const sourceData = data.formData || data.form_response;
    let students = null;
    if (sourceData) {
      data.formData = await enrichStudentListInFormData(sourceData, procData);
      const studentListKey = Object.keys(data.formData).find(k => Array.isArray(data.formData[k]) && data.formData[k].length > 0 && data.formData[k][0].mits_uid);
      if (studentListKey) {
        students = data.formData[studentListKey];
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: "Request details resolved",
      data: {
        req_id: req.req_id,
        procedure_title: req.Procedures?.title || "Unknown Request",
        created_at: req.created_at,
        status: req.status,
        status_text,
        color,
        current_level,
        total_levels,
        approvalHistory,
        formData: data.formData || {},
        students: students,
        isBulk: students !== null,
        studentName: userData?.Student?.name || data.studentName || "Unknown",
        studentId: req.created_by,
        department: userData?.Student?.Classes?.Departments?.dept_name || "N/A",
        lastLevelRoleTag,
        is_resolved: true,
      }
    };
  } catch (error) {
    console.error("getRequestDetails error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getStudentDashboardData(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "User not found" };

    const mits_uid = userAccount.mits_uid;

    // 1. Fetch Stats
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.requests.count({ where: { created_by: mits_uid, status: 0 } }),
      prisma.requests.count({ where: { created_by: mits_uid, status: 1 } }),
      prisma.requests.count({ where: { created_by: mits_uid, status: 2 } }),
    ]);

    // 2. Fetch Latest Requests (Latest 3)
    const latestRequestsRaw = await prisma.requests.findMany({
      where: { created_by: mits_uid },
      include: { Procedures: true },
      orderBy: { created_at: 'desc' },
      take: 3,
    });

    const activeRequests = [];
    for (const req of latestRequestsRaw) {
      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (snap.exists) {
        const data = snap.data()!;
        const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
        const procData = procDoc.exists ? procDoc.data() : null;

        const { text: status } = await resolveRequestStatus(req, procData, data.current_level || 1);

        activeRequests.push({
          id: req.req_id,
          title: req.Procedures?.title || "Unknown Request",
          date: req.created_at.toISOString().split('T')[0],
          status: status,
          currentLevel: data.current_level || 1,
        });
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: "Dashboard data fetched",
      data: {
        stats: { pending: pendingCount, approved: approvedCount, rejected: rejectedCount },
        activeRequests,
        notifications: [
          // Placeholder for now, can be implemented with a real notification system later
          { id: "1", title: "Welcome to SAMS", description: "Your dashboard is now live with real data.", time: "Just now", type: "info" }
        ]
      }
    };
  } catch (error: any) {
    console.error("getStudentDashboardData error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function withdrawRequest(requestId: string, user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "User not found" };

    const request = await prisma.requests.findUnique({
      where: { req_id: requestId }
    });

    if (!request) return { success: false, statusCode: 404, message: "Request not found" };
    if (request.created_by !== userAccount.mits_uid) {
      return { success: false, statusCode: 403, message: "Not authorized to withdraw this request" };
    }
    if (request.status !== 0) {
      return { success: false, statusCode: 400, message: "Only pending requests can be withdrawn" };
    }

    // 1. Get current approvers to decrement analytics
    const pendingApprovals = await prisma.toApprove.findMany({
      where: { req_id: requestId }
    });

    for (const app of pendingApprovals) {
      try {
        if (app.approvalType) {
          const roleRow = await prisma.roles.findFirst({
            where: { role_tag: { equals: app.approvalType, mode: 'insensitive' } }
          });
          if (roleRow) {
            await prisma.analytics.update({
              where: { mits_uid_role_id: { mits_uid: app.approverUID, role_id: roleRow.role_id } },
              data: { pending: { decrement: 1 } }
            }).catch(() => { }); // Ignore if record doesn't exist
          }
        }
      } catch (e) {
        console.error("Failed to decrement analytics during withdrawal:", e);
      }
    }

    // 2. Delete action items
    await prisma.toApprove.deleteMany({
      where: { req_id: requestId }
    });

    // 3. Update SQL status
    await prisma.requests.update({
      where: { req_id: requestId },
      data: { status: 3 }
    });

    // 4. Update Firestore status
    const nowISO = new Date().toISOString();
    await firestore.collection("requests").doc(requestId).update({
      status: "WITHDRAWN",
      updatedAt: nowISO,
      last_updated_at: nowISO,
      timeline: admin.firestore.FieldValue.arrayUnion({
        action: "WITHDRAWN",
        by: "STUDENT",
        timestamp: nowISO
      })
    });

    // 5. Send notification to student
    try {
      await publishRequestWithdrawn(requestId, [userAccount.mits_uid]);
    } catch (e) {
      console.error("Failed to enqueue withdrawn notification:", e);
    }

    return { success: true, statusCode: 200, message: "Request withdrawn successfully" };
  } catch (error: any) {
    console.error("withdrawRequest error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}
