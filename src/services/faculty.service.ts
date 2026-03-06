import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";
import { enrichStudentListInFormData, getUserNameFromUid, getLastLevelRoleTag } from "./requests.service.js";
import { processHostellerNotification } from "./hostel.service.js";
import { processPlacementAttendance } from "./placement.service.js";
import { publishApprovalUpdate, publishFinalApproval, publishRequestRejected } from "../queues/producers/importantProducer.js";

interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}


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


export async function getRequestsToApproveService(payload: any) {
  try {
    const mits_uid = (payload.user.mits_uid as string);
    const normalizedFacultyUid = mits_uid.trim().toLowerCase();
    const selectedRole = (payload.query?.role as string)?.trim().toLowerCase();

    if (!selectedRole) {
      return { success: false, statusCode: 400, message: "Role parameter is required" };
    }

    const approvals = await prisma.toApprove.findMany({
      where: {
        approverUID: normalizedFacultyUid,
        ...(selectedRole && selectedRole !== "all" ? { approvalType: { equals: selectedRole, mode: 'insensitive' } } : {})
      },
      include: {
        Requests: {
          include: {
            Procedures: true,
          }
        }
      }
    });
    if (approvals.length === 0) {
      return { success: true, statusCode: 200, message: "No pending requests found", data: { requests: [] } };
    }

    // 1. Batch fetch all Firestore Documents for performance (O(1) approach)
    const reqIds = approvals.map(a => a.Requests.req_id);
    const procIds = [...new Set(approvals.map(a => a.Requests.proc_id))];

    const [requestSnaps, procedureSnaps] = await Promise.all([
      firestore.getAll(...reqIds.map(id => firestore.collection("requests").doc(id))),
      firestore.getAll(...procIds.map(id => firestore.collection("procedures").doc(id)))
    ]);

    const requestMap = new Map(requestSnaps.map(s => [s.id, s.exists ? s.data() : null]));
    const procedureMap = new Map(procedureSnaps.map(s => [s.id, s.exists ? s.data() : null]));

    // 2. Batch fetch Student/Faculty names for all UIDs involved (Requesters + Approvers in History)
    const allUids = new Set<string>();
    approvals.forEach(a => allUids.add(a.Requests.created_by));
    requestSnaps.forEach(s => {
      const d = s.data();
      if (d?.approval_progress) {
        d.approval_progress.forEach((p: any) => p.decisions?.forEach((dec: any) => allUids.add(dec.mits_uid)));
      }
    });

    const [facultyNames, studentNames] = await Promise.all([
      prisma.faculty.findMany({ where: { mits_uid: { in: [...allUids] } } }),
      prisma.student.findMany({
        where: { mits_uid: { in: [...allUids] } },
        include: { Classes: { include: { Departments: true } } }
      })
    ]);

    const nameMap = new Map<string, string>();
    facultyNames.forEach(f => nameMap.set(f.mits_uid, f.name));
    studentNames.forEach(s => nameMap.set(s.mits_uid, s.name));

    const studentDataMap = new Map(studentNames.map(s => [s.mits_uid, s]));

    const approvableRequests: any[] = [];

    for (const app of approvals) {
      const req = app.Requests;
      const data = requestMap.get(req.req_id);
      const procedureDef = procedureMap.get(req.proc_id);

      if (!data) continue;

      const currentLevel = data.current_level;

      const approvalHistory: any[] = [];
      const historyBlocks = (data.approval_progress || []).filter((lvl: any) => lvl.level < currentLevel);
      for (const block of historyBlocks) {
        const levelDefHistory = procedureDef?.approvalLevels?.find((l: any) => l.level === block.level);
        const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
        for (const decision of block.decisions) {
          if (decision.decision) {
            approvalHistory.push({
              level: block.level,
              approverName: nameMap.get(decision.mits_uid) || "Unknown User",
              role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
              status: decision.decision,
              comments: decision.comments,
              timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
            });
          }
        }
      }

      // Enrich student lists (names/genders)
      const sourceData = data.formData || data.form_response;
      let students = null;
      if (sourceData) {
        data.formData = await enrichStudentListInFormData(sourceData, procedureDef, selectedRole);

        // Expose student list at top level if found in formData
        const studentListKey = Object.keys(data.formData).find(k => Array.isArray(data.formData[k]) && data.formData[k].length > 0 && data.formData[k][0].mits_uid);
        if (studentListKey) {
          students = data.formData[studentListKey];
        }
      }

      const student = studentDataMap.get(req.created_by);

      approvableRequests.push({
        id: req.req_id,
        type: req.Procedures?.title || "Request",
        studentName: student?.name || data.studentName || "Unknown",
        studentId: req.created_by,
        department: student?.Classes?.Departments?.dept_name || "N/A",
        date: req.created_at.toISOString().split("T")[0],
        description: (data.formData)
          ? Object.entries(data.formData)
            .filter(([k]) => k !== "DEBUG_SYNC" && k !== "attachmentUrl" && k !== "attachmentPath" && k !== "attachmentName" && k !== "attachmentType")
            .map(([k, v]: [string, any]) => {
              if (v && typeof v === 'object' && v.name) return `${k}: ${v.name}`;
              if (v && typeof v === 'object' && Array.isArray(v)) return `${k}: [List of ${v.length}]`;
              return `${k}: ${v}`;
            }).join(" | ")
          : "No description",
        attachments: data.attachments || [],
        roleTag: app.approvalType || selectedRole,
        color: "blue",
        formData: data.formData || {},
        students: students,
        isBulk: students !== null,
        approvalHistory: approvalHistory,
        lastLevelRoleTag: data.lastLevelRoleTag || getLastLevelRoleTag(procedureDef)
      });
    }

    return { success: true, statusCode: 200, message: "Pending requests fetched", data: { requests: approvableRequests } };
  } catch (error: any) {
    console.error("getRequestsToApproveService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function approveRequestService(payload: any): Promise<Result> {
  try {
    const mits_uid = (payload.user.mits_uid as string);
    const normalizedFacultyUid = mits_uid.trim().toLowerCase();
    const { requestId, role, comments } = payload.body;
    const normalizedRole = (role as string)?.trim().toLowerCase();

    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request not found" };

    const data = snap.data()!;
    if (data.status !== "PENDING") {
      return { success: false, statusCode: 400, message: `Request is already ${data.status.toLowerCase()}` };
    }
    const approvalProgress = data.approval_progress || data.approvalProgress || [];
    const currentLevel = data.current_level !== undefined ? data.current_level : (data.currentLevel !== undefined ? data.currentLevel : 1);
    const procId = data.procId || data.proc_id || data.procedure_id || data.procedureId;
    const studentId = data.studentId || data.student_id || data.studentUID || data.created_by || data.createdBy;

    if (!procId) {
      console.error(`Approval failed: Request ${requestId} missing procId mapping.`);
      return { success: false, statusCode: 500, message: "Request data corrupted: missing procedure ID" };
    }

    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    const myDecision = levelBlock?.decisions.find((d: any) => d.mits_uid?.trim().toLowerCase() === normalizedFacultyUid);
    if (!myDecision) return { success: false, statusCode: 403, message: "Not authorized" };

    myDecision.decision = "APPROVED";
    myDecision.timestamp = new Date().toISOString();
    myDecision.comments = comments || null;
    myDecision.role = role;

    // 1. Remove the action item for the faculty who just approved
    await prisma.toApprove.delete({
      where: {
        req_id_approverUID: {
          req_id: requestId,
          approverUID: normalizedFacultyUid
        }
      }
    }).catch((e: any) => console.error("ToApprove delete error (likely already gone):", e));

    const approvalsDone = levelBlock.decisions.filter((d: any) => d.decision === "APPROVED").length;
    if (approvalsDone >= levelBlock.required_approvals) {
      levelBlock.net_status = "APPROVED";

      // 2. Clear remaining action items for this request at the current level (if any)
      await prisma.toApprove.deleteMany({
        where: { req_id: requestId, approvalLevel: currentLevel }
      });

      const procSnap = await firestore.collection("procedures").doc(procId).get();
      const procedure = procSnap.data();
      const nextLevelNum = currentLevel + 1;
      const nextLevelDef = procedure?.approvalLevels?.find((l: any) => l.level === nextLevelNum);

      if (nextLevelDef) {
        data.current_level = nextLevelNum;
        let nextApprovers: string[] = [];
        for (const roleTag of (nextLevelDef.roleIds || [nextLevelDef.role])) {
          const uids = await resolveApproversForRole(roleTag, studentId);
          nextApprovers.push(...uids);
        }
        nextApprovers = [...new Set(nextApprovers)];
        approvalProgress.push({
          level: nextLevelNum,
          net_status: "PENDING",
          required_approvals: nextLevelDef.allMustApprove ? nextApprovers.length : (nextLevelDef.minApprovals || 1),
          decisions: nextApprovers.map(uid => ({ mits_uid: uid }))
        });

        // 3. Populate ToApprove table for next level approvers
        const nextLevelRole = (nextLevelDef.roleIds || [nextLevelDef.role])?.[0] || "Approver";
        const toApproveData = nextApprovers.map(uid => ({
          req_id: requestId,
          approverUID: uid,
          approvalLevel: nextLevelNum,
          approvalType: nextLevelRole
        }));

        if (toApproveData.length > 0) {
          await prisma.toApprove.createMany({
            data: toApproveData,
            skipDuplicates: true
          });

          // Sync Analytics pending for next level
          try {
            const roleRow = await prisma.roles.findFirst({
              where: { role_tag: { equals: nextLevelRole, mode: 'insensitive' } }
            });
            if (roleRow) {
              for (const uid of nextApprovers) {
                await prisma.analytics.upsert({
                  where: { mits_uid_role_id: { mits_uid: uid, role_id: roleRow.role_id } },
                  create: { mits_uid: uid, role_id: roleRow.role_id, pending: 1, approved: 0, rejected: 0 },
                  update: { pending: { increment: 1 } }
                });
              }
            }
          } catch (e) {
            console.error("Failed to update next level Analytics pending counts:", e);
          }
        }

        // 4. Trigger SQS Notification for Intermediate Approval (Non-blocking)
        publishApprovalUpdate(
          requestId,
          [studentId],
          normalizedFacultyUid,
          nextLevelNum
        ).catch((err) => {
          console.error("Failed to enqueue approval update notification:", err);
        });

      } else {
        data.status = "APPROVED";
        await prisma.requests.update({ where: { req_id: requestId }, data: { status: 1 } });

        publishFinalApproval(requestId, [studentId]).catch((err) => {
          console.error("Failed to enqueue final approval notification:", err);
        });

        // Trigger Standardized System Hook (END) after full approval
        if (procedure?.system_hook && procedure?.hook_trigger === "END") {
          const formData = data.formData || {};
          const hookData = formData.hook_data || formData.student_list || formData.uids || [];
          console.log(`[SYSTEM_HOOK_END] Hook data to process:`, JSON.stringify(hookData).substring(0, 500), hookData.length > 0 ? "..." : "");

          console.log(`[SYSTEM_HOOK_END] Triggering ${procedure.system_hook} for approved request ${requestId}`);

          if (procedure.system_hook === "OVERNIGHT_HOSTEL") {
            await processHostellerNotification({
              procedureId: procId,
              hookData: Array.isArray(hookData) ? hookData : [],
              coordinatorUid: studentId,
              eventName: formData.event_name || formData.title || "Hostel Notification",
              date: formData.event_date || formData.date || new Date().toISOString().split('T')[0],
            });
          } else if (procedure.system_hook === "PLACEMENT_BULK") {
            await processPlacementAttendance({
              procedureId: procId,
              hookData: Array.isArray(hookData) ? hookData : [],
              coordinatorUid: studentId,
              eventName: formData.event_name || formData.title || "Placement Event Approved",
              date: formData.test_date || formData.date || new Date().toISOString().split('T')[0],
            });
          }
        }
      }
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      current_level: data.current_level,
      status: data.status,
      last_updated_at: new Date().toISOString()
    });

    // Sync to SQL Analytics table
    try {
      if (normalizedRole) {
        const roleRow = await prisma.roles.findFirst({
          where: { role_tag: { equals: normalizedRole, mode: 'insensitive' } }
        });
        if (roleRow) {
          await prisma.analytics.upsert({
            where: { mits_uid_role_id: { mits_uid: mits_uid.trim(), role_id: roleRow.role_id } },
            create: { mits_uid: mits_uid.trim(), role_id: roleRow.role_id, approved: 1, pending: 0 },
            update: { approved: { increment: 1 }, pending: { decrement: 1 } }
          });
        }
      }
    } catch (e) {
      console.error("Failed to update SQL Analytics (approve):", e);
    }

    return { success: true, statusCode: 200, message: "Request approved" };
  } catch (error) {
    console.error("approveRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function rejectRequestService(payload: any): Promise<Result> {
  try {
    const mits_uid = (payload.user.mits_uid as string);
    const normalizedFacultyUid = mits_uid.trim().toLowerCase();
    const { requestId, role, reason } = payload.body;
    const normalizedRole = (role as string)?.trim().toLowerCase();

    if (!requestId || !role || !reason) {
      return { success: false, statusCode: 400, message: "requestId, role, and reason are required" };
    }

    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request not found" };

    const data = snap.data()!;
    if (data.status !== "PENDING") {
      return { success: false, statusCode: 400, message: `Request is already ${data.status.toLowerCase()}` };
    }
    const approvalProgress = data.approval_progress || data.approvalProgress || [];
    const currentLevel = data.current_level !== undefined ? data.current_level : (data.currentLevel !== undefined ? data.currentLevel : 1);
    const levelBlock = approvalProgress.find((lvl: any) => lvl.level === currentLevel);
    const myDecision = levelBlock?.decisions.find((d: any) => d.mits_uid?.trim().toLowerCase() === normalizedFacultyUid);

    if (myDecision) {
      myDecision.decision = "REJECTED";
      myDecision.timestamp = new Date().toISOString();
      myDecision.comments = reason;
      myDecision.role = role;
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      status: "REJECTED",
      rejection_info: {
        rejected_by: mits_uid.trim(),
        role: role,
        reason: reason,
        timestamp: new Date().toISOString()
      },
      last_updated_at: new Date().toISOString()
    });

    await prisma.requests.update({
      where: { req_id: requestId },
      data: { status: 2 }
    });

    publishRequestRejected(requestId, [data.created_by || data.studentId || data.student_id], reason).catch((err: any) => {
      console.error("Failed to enqueue rejection notification:", err);
    });

    await prisma.toApprove.deleteMany({
      where: { req_id: requestId }
    });

    // Sync to SQL Analytics table
    try {
      if (normalizedRole) {
        const roleRow = await prisma.roles.findFirst({
          where: { role_tag: { equals: normalizedRole, mode: 'insensitive' } }
        });
        if (roleRow) {
          await prisma.analytics.upsert({
            where: { mits_uid_role_id: { mits_uid: mits_uid.trim(), role_id: roleRow.role_id } },
            create: { mits_uid: mits_uid.trim(), role_id: roleRow.role_id, rejected: 1, pending: 0 },
            update: { rejected: { increment: 1 }, pending: { decrement: 1 } }
          });
        }
      }
    } catch (e) {
      console.error("Failed to update SQL Analytics (reject):", e);
    }

    return { success: true, statusCode: 200, message: "Request rejected" };
  } catch (error) {
    console.error("rejectRequestService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getActedRequestsService(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "Faculty account not found" };
    const facultyUid = userAccount.mits_uid;

    const requestsSnap = await firestore.collection("requests").get();
    const actedRequests: any[] = [];

    for (const doc of requestsSnap.docs) {
      const data = doc.data();
      let actedOn = false;
      const normalizedFacultyUid = facultyUid.toLowerCase();
      for (const level of (data.approval_progress || [])) {
        if (level.decisions?.some((d: any) => d.mits_uid?.toLowerCase() === normalizedFacultyUid && d.decision)) {
          actedOn = true;
          break;
        }
      }
      if (actedOn) {
        const req_id = doc.id;
        const prismaReq = await prisma.requests.findUnique({ where: { req_id }, include: { Procedures: true } });
        const procDoc = await firestore.collection("procedures").doc(prismaReq?.proc_id || "").get();
        const total_levels = procDoc.exists ? (procDoc.data()?.approvalLevels?.length || 1) : 1;

        let status_text = "Pending";
        let color = "warning";
        if (prismaReq?.status === 1) { status_text = "Approved"; color = "success"; }
        else if (prismaReq?.status === 2) { status_text = "Rejected"; color = "error"; }
        else if (prismaReq) {
          const activeLevel = procDoc.data()?.approvalLevels?.find((l: any) => l.level === data.current_level);
          const roleName = (activeLevel?.role || activeLevel?.roleIds?.[0] || "Approver").replaceAll('_', ' ').toUpperCase();
          status_text = `Pending ${roleName}`;
        }

        const student = await prisma.student.findUnique({
          where: { mits_uid: prismaReq?.created_by || "" },
          include: { Classes: { include: { Departments: true } } }
        });

        // Enrich student lists (names/genders) - skip if needed
        const sourceData = data.formData || data.form_response;
        let students = null;
        if (sourceData) {
          data.formData = await enrichStudentListInFormData(sourceData, procDoc.exists ? procDoc.data() : null);

          // Expose student list at top level if found in formData
          const studentListKey = Object.keys(data.formData).find(k => Array.isArray(data.formData[k]) && data.formData[k].length > 0 && data.formData[k][0].mits_uid);
          if (studentListKey) {
            students = data.formData[studentListKey];
          }
        }

        let approvalHistory: any[] = [];
        const historyBlocks = (data.approval_progress || []);
        for (const block of historyBlocks) {
          const levelDefHistory = procDoc.data()?.approvalLevels?.find((l: any) => l.level === block.level);
          const fallbackRole = levelDefHistory?.role || levelDefHistory?.roleIds?.[0] || "Approver";
          for (const decision of block.decisions) {
            if (decision.decision) {
              const histEntry = {
                level: block.level,
                approverName: await getUserNameFromUid(decision.mits_uid),
                role: (decision.role || block.role || fallbackRole).replaceAll('_', ' ').toUpperCase(),
                status: decision.decision,
                comments: decision.comments,
                timestamp: decision.timestamp ? decision.timestamp.split('T')[0] : ""
              };
              approvalHistory.push(histEntry);
            }
          }
        }

        actedRequests.push({
          req_id,
          procedure_title: prismaReq?.Procedures?.title || "Unknown Request",
          created_at: prismaReq?.created_at,
          status: prismaReq?.status,
          status_text,
          color,
          current_level: data.current_level || 1,
          total_levels,
          formData: data.formData || {},
          description: (data.formData)
            ? Object.entries(data.formData)
              .filter(([k]) => k !== "DEBUG_SYNC" && k !== "attachmentUrl" && k !== "attachmentPath" && k !== "attachmentName" && k !== "attachmentType")
              .map(([k, v]: [string, any]) => {
                if (v && typeof v === 'object' && v.name) return `${k}: ${v.name}`;
                if (v && typeof v === 'object' && Array.isArray(v)) return `${k}: [List of ${v.length}]`;
                return `${k}: ${v}`;
              }).join(" | ")
            : "No description",
          students: students,
          isBulk: students !== null,
          studentName: student?.name || data.studentName || "Unknown",
          studentId: prismaReq?.created_by,
          department: student?.Classes?.Departments?.dept_name || "N/A",
          roleTag: (procDoc.data()?.approvalLevels?.find((l: any) => l.level === data.current_level)?.role || "Approver"),
          approvalHistory: approvalHistory,
          lastLevelRoleTag: data.lastLevelRoleTag || getLastLevelRoleTag(procDoc.data())
        });
      }
    }
    return { success: true, statusCode: 200, message: "Acted requests fetched", data: actedRequests };
  } catch (error) {
    console.error("getActedRequestsService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getFacultyDashboardDataService(user: any, query: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "Faculty account not found" };
    const facultyUid = userAccount.mits_uid.trim();
    const selectedRole = (query?.role as string)?.trim().toLowerCase();

    let approvedCount = 0;
    let rejectedCount = 0;

    if (selectedRole && selectedRole !== "all") {
      const roleRow = await prisma.roles.findFirst({
        where: { role_tag: { equals: selectedRole, mode: 'insensitive' } }
      });
      if (roleRow) {
        const stats = await prisma.analytics.findUnique({
          where: { mits_uid_role_id: { mits_uid: facultyUid, role_id: roleRow.role_id } }
        });
        approvedCount = stats?.approved || 0;
        rejectedCount = stats?.rejected || 0;
      }
    } else {
      const stats = await prisma.analytics.aggregate({
        where: { mits_uid: facultyUid },
        _sum: { approved: true, rejected: true }
      });
      approvedCount = stats._sum.approved || 0;
      rejectedCount = stats._sum.rejected || 0;
    }

    const procTitlesSnap = await prisma.procedures.findMany({ select: { proc_id: true, title: true } });
    const procMap: Record<string, string> = {};
    procTitlesSnap.forEach(p => procMap[p.proc_id] = p.title);

    const typeBreakdown: Record<string, number> = {};
    const requestsSnap = await firestore.collection("requests").get();
    const normalizedFacultyUid = facultyUid.toLowerCase();

    for (const doc of requestsSnap.docs) {
      const data = doc.data();
      const title = procMap[data.procId] || "Unknown";

      for (const level of (data.approval_progress || [])) {
        for (const decision of (level.decisions || [])) {
          if (decision.mits_uid?.trim().toLowerCase() === normalizedFacultyUid && decision.decision) {
            const decisionRole = (decision.role || level.role || "approver").trim().toLowerCase();
            if (!selectedRole || selectedRole === "all" || decisionRole === selectedRole) {
              typeBreakdown[title] = (typeBreakdown[title] || 0) + 1;
            }
          }
        }
      }
    }

    const pendingApprovals = await getRequestsToApproveService({ user: { mits_uid: facultyUid }, query: { role: selectedRole || "all" } });
    const pendingList = (pendingApprovals.success && pendingApprovals.data) ? (pendingApprovals.data.requests || []) : [];
    const pendingCount = pendingList.length;

    return {
      success: true,
      statusCode: 200,
      message: "Dashboard data fetched",
      data: {
        stats: {
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
          total: approvedCount + rejectedCount + pendingCount
        },
        breakdown: Object.entries(typeBreakdown).map(([label, count]) => ({ label, count })),
        recentPending: pendingList.slice(0, 3).map((r: any) => ({
          id: r.id,
          subject: r.type,
          date: r.date,
          status: "Pending Your Action"
        })),
        updates: [
          { msg: `You have ${pendingCount} new requests waiting for approval.`, time: "Just now", color: "blue" },
          { msg: `Total requests processed by you: ${approvedCount + rejectedCount}`, time: "Today", color: "green" }
        ]
      }
    };
  } catch (error) {
    console.error("getFacultyDashboardDataService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getFacultyProfileService(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({
      where: { auth_uid: user.uid },
    });

    if (!userAccount) return { success: false, statusCode: 404, message: "Faculty account not found" };

    const faculty = await prisma.faculty.findUnique({
      where: { mits_uid: userAccount.mits_uid },
      include: {
        Departments: true,
        ClassFaculty: {
          include: {
            Classes: true
          }
        }
      }
    });

    const roleMappings = await prisma.roleMapping.findMany({
      where: { mits_uid: userAccount.mits_uid, is_active: true },
      include: { Roles: true }
    });

    if (!faculty) {
      return { success: false, statusCode: 404, message: "Faculty profile not found" };
    }
    const assignedClasses = faculty.ClassFaculty.map(cf => ({
      className: cf.Classes.class,
      role: cf.role_tag.replaceAll('_', ' ').toUpperCase()
    }));

    const roles = roleMappings.map(rm => rm.Roles.role_tag.replaceAll('_', ' ').toUpperCase());

    return {
      success: true,
      statusCode: 200,
      message: "Faculty profile fetched",
      data: {
        mits_uid: faculty.mits_uid,
        name: faculty.name,
        email: faculty.email,
        department: faculty.Departments.dept_name,
        assignedClasses: assignedClasses,
        roles: roles,
        designation: "Faculty Member"
      }
    };
  } catch (error) {
    console.error("getFacultyProfileService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}

export async function getFacultyNotificationsService(user: any): Promise<Result> {
  try {
    const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
    if (!userAccount) return { success: false, statusCode: 404, message: "Faculty account not found" };
    const facultyUid = userAccount.mits_uid.trim();

    const notifications: any[] = [];
    const myRequests = await prisma.requests.findMany({
      where: { created_by: facultyUid },
      include: { Procedures: true },
      orderBy: { created_at: 'desc' },
      take: 10
    });

    myRequests.forEach(req => {
      let statusText = "submitted";
      let type = "info";
      if (req.status === 1) { statusText = "approved"; type = "success"; }
      if (req.status === 2) { statusText = "rejected"; type = "error"; }

      notifications.push({
        id: `own-${req.req_id}`,
        title: `Request ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`,
        description: `Your request for "${req.Procedures.title}" has been ${statusText}.`,
        time: req.created_at.toISOString(),
        isUnread: false,
        type: type
      });
    });

    const pendingResult = await getRequestsToApproveService({ user: { mits_uid: facultyUid }, query: { role: "all" } });
    if (pendingResult.success && pendingResult.data?.requests) {
      pendingResult.data.requests.forEach((req: any) => {
        notifications.push({
          id: `pending-${req.id}`,
          title: "Action Required",
          description: `${req.studentName} has submitted a "${req.type}" for your approval.`,
          time: new Date(req.date).toISOString(),
          isUnread: true,
          type: "warning"
        });
      });
    }

    notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return { success: true, statusCode: 200, message: "Notifications fetched", data: notifications };
  } catch (error) {
    console.error("getFacultyNotificationsService error:", error);
    return { success: false, statusCode: 500, message: "Internal server error" };
  }
}
