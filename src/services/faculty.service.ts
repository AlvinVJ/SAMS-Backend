import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";
import { enrichStudentListInFormData, getUserNameFromUid } from "./requests.service.js";

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
            UserAccount: {
              include: {
                Student: {
                  include: {
                    Classes: {
                      include: { Departments: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const approvableRequests: any[] = [];

    for (const app of approvals) {
      const req = app.Requests;
      const snap = await firestore.collection("requests").doc(req.req_id).get();
      if (!snap.exists) continue;

      const data = snap.data()!;
      const currentLevel = data.current_level;

      const procDoc = await firestore.collection("procedures").doc(req.proc_id).get();
      const procedureDef = procDoc.exists ? procDoc.data() : null;

      const approvalHistory: any[] = [];
      const historyBlocks = (data.approval_progress || []).filter((lvl: any) => lvl.level < currentLevel);
      for (const block of historyBlocks) {
        const levelDefHistory = procedureDef?.approvalLevels?.find((l: any) => l.level === block.level);
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

      approvableRequests.push({
        id: req.req_id,
        type: req.Procedures?.title || "Request",
        studentName: req.UserAccount?.Student?.name || data.studentName || "Unknown",
        studentId: req.created_by,
        department: req.UserAccount?.Student?.Classes?.Departments?.dept_name || "N/A",
        date: req.created_at.toISOString().split("T")[0],
        description: (data.formData) ? Object.entries(data.formData).filter(([k]) => k !== "DEBUG_SYNC").map(([k, v]) => `${k}: ${v}`).join(" | ") : "No description",
        attachments: data.attachments || [],
        roleTag: app.approvalType || selectedRole,
        color: "blue",
        formData: data.formData || {},
        students: students,
        isBulk: students !== null,
        approvalHistory: approvalHistory,
        lastLevelRoleTag: (procedureDef as any)?.approvalLevels?.length > 0
          ? ((procedureDef as any).approvalLevels[(procedureDef as any).approvalLevels.length - 1].role || (procedureDef as any).approvalLevels[(procedureDef as any).approvalLevels.length - 1].roleIds?.[0] || "Approver")
          : "Approver"
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
    const { requestId, role, comments, nextApproverUid } = payload.body;
    const normalizedRole = (role as string)?.trim().toLowerCase();

    const requestRef = firestore.collection("requests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return { success: false, statusCode: 404, message: "Request not found" };

    const data = snap.data()!;
    const approvalProgress = data.approval_progress || data.approvalProgress || [];
    const currentLevel = data.current_level !== undefined ? data.current_level : (data.currentLevel !== undefined ? data.currentLevel : 1);
    const procId = data.procId || data.proc_id || data.procedure_id || data.procedureId;
    const studentId = data.studentId || data.student_id || data.studentUID;

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

    if (nextApproverUid) {
      // -------------------------------------------------------------
      // CASE B: Optional Ad-hoc Forwarding
      // -------------------------------------------------------------
      const nextLevelNum = Number((currentLevel + 0.01).toFixed(2));
      data.current_level = nextLevelNum;

      approvalProgress.push({
        level: nextLevelNum,
        net_status: "PENDING",
        required_approvals: 1,
        decisions: [{ mits_uid: nextApproverUid }],
        isAdhoc: true, // Marker for ad-hoc step
        forwardedBy: normalizedFacultyUid
      });

      // Populate ToApprove for the single ad-hoc approver using upsert to avoid unique constraint violations
      await prisma.toApprove.upsert({
        where: {
          req_id_approverUID: {
            req_id: requestId,
            approverUID: nextApproverUid
          }
        },
        create: {
          req_id: requestId,
          approverUID: nextApproverUid,
          approvalLevel: nextLevelNum,
          approvalType: "Ad-hoc (Forwarded)"
        },
        update: {
          approvalLevel: nextLevelNum,
          approvalType: "Ad-hoc (Forwarded)"
        }
      });
    } else {
      // -------------------------------------------------------------
      // CASE A: Standard Procedure Progression
      // -------------------------------------------------------------
      const approvalsDone = levelBlock.decisions.filter((d: any) => d.decision === "APPROVED").length;
      if (approvalsDone >= levelBlock.required_approvals) {
        levelBlock.net_status = "APPROVED";

        // Clear remaining action items for this request at the current level (if any)
        await prisma.toApprove.deleteMany({
          where: { req_id: requestId, approvalLevel: currentLevel }
        });

        const procSnap = await firestore.collection("procedures").doc(procId).get();
        const procedure = procSnap.data();

        // Use Math.floor + 1 to resume even from an ad-hoc step (e.g., 1.01 -> 2)
        const nextLevelNum = Math.floor(currentLevel) + 1;
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

          // Populate ToApprove table for next level approvers
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
                where: { role_tag: { equals: nextLevelRole, mode: "insensitive" } }
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
        } else {
          data.status = "APPROVED";
          await prisma.requests.update({ where: { req_id: requestId }, data: { status: 1 } });
        }
      }
    }

    await requestRef.update({
      approval_progress: approvalProgress,
      current_level: data.current_level,
      status: data.status || "PENDING",
      last_updated_at: new Date().toISOString()
    });

    // Sync to SQL Analytics table for the approver who just acted
    try {
      if (normalizedRole) {
        const roleRow = await prisma.roles.findFirst({
          where: { role_tag: { equals: normalizedRole, mode: "insensitive" } }
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

        const userData = await prisma.userAccount.findUnique({
          where: { mits_uid: prismaReq?.created_by || "" },
          include: { Student: { include: { Classes: { include: { Departments: true } } } } }
        });

        // Enrich student lists (names/genders)
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
          students: students,
          isBulk: students !== null,
          studentName: userData?.Student?.name || data.studentName || "Unknown",
          studentId: prismaReq?.created_by,
          department: userData?.Student?.Classes?.Departments?.dept_name || "N/A",
          roleTag: (procDoc.data()?.approvalLevels?.find((l: any) => l.level === data.current_level)?.role || "Approver"),
          approvalHistory: approvalHistory,
          lastLevelRoleTag: (procDoc.data() as any)?.approvalLevels?.length > 0
            ? ((procDoc.data() as any).approvalLevels[(procDoc.data() as any).approvalLevels.length - 1].role || (procDoc.data() as any).approvalLevels[(procDoc.data() as any).approvalLevels.length - 1].roleIds?.[0] || "Approver")
            : "Approver"
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
      include: {
        Faculty: {
          include: {
            Departments: true,
            ClassFaculty: {
              include: {
                Classes: true
              }
            }
          }
        },
        RoleMapping: {
          include: {
            Roles: true
          }
        }
      }
    });

    if (!userAccount || !userAccount.Faculty) {
      return { success: false, statusCode: 404, message: "Faculty profile not found" };
    }

    const faculty = userAccount.Faculty;
    const assignedClasses = faculty.ClassFaculty.map(cf => ({
      className: cf.Classes.class,
      role: cf.role_tag.replaceAll('_', ' ').toUpperCase()
    }));

    const roles = userAccount.RoleMapping.map(rm => rm.Roles.role_tag.replaceAll('_', ' ').toUpperCase());

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
