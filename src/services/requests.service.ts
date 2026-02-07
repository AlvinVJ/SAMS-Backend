import { prisma } from "../db/prisma.js";
import { firestore } from "../config/firebase.js";
interface Result {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);
// --- Helper: Resolve Approvers ---
async function resolveApproversForRole(roleTag: string, requesterUid: string): Promise<string[]> {
  const normalizedTag = roleTag.toLowerCase();
  console.log(`[DEBUG] Resolving approvers for role: ${normalizedTag} (Requester: ${requesterUid})`);
  if (normalizedTag === "class_advisor") {
    const student = await prisma.student.findUnique({
      where: { mits_uid: requesterUid },
      select: { class_id: true },
    });
    
    if (!student || !student.class_id) {
        console.log(`[DEBUG] Student/Class not found for UID: ${requesterUid}`);
        return [];
    }
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
  // --- FIX: Using findFirst instead of findUnique to allow case-insensitive filter ---
  const role = await prisma.roles.findFirst({
    where: { role_tag: { equals: normalizedTag, mode: 'insensitive' } },
    select: { role_id: true },
  });
  
  if (!role) {
      console.log(`[DEBUG] Role NOT FOUND: ${normalizedTag}`);
      return [];
  }
  const mappings = await prisma.roleMapping.findMany({
    where: {
      role_id: role.role_id,
      is_active: true,
      deleted_at: null,
    },
    select: { mits_uid: true },
  });
  
  return mappings.map(m => m.mits_uid);
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
    }
    // Create SQL
    await prisma.requests.create({
      data: {
        req_id: requestId,
        proc_id: procedureId,
        created_by: userAccount.mits_uid,
        status: 0, 
      },
    });
    // Create Firestore
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
  
      const formatted = requests.map((req) => ({
        req_id: req.req_id,
        procedure_title: req.Procedures?.title || "Unknown Request",
        created_at: req.created_at,
        status: req.status,
        current_level: 1 
      }));
  
      return { success: true, statusCode: 200, message: "Requests fetched", data: formatted };
    } catch (error) {
      console.error("getMyRequests error:", error);
      return { success: false, statusCode: 500, message: "Internal server error" };
    }
}