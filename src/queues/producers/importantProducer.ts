// src/queues/producers/importantProducer.ts

import { sendToSQS, SQS_QUEUES } from "../../config/sqs.js";
import { NotificationTypes } from "../event.js";

/**
 * Publish an important notification (approval/request related)
 */
export async function publishApprovalAlert(requestId: string, targetUserIds: string[]) {
  await sendToSQS(SQS_QUEUES.IMPORTANT!, {
    type: NotificationTypes.APPROVAL_ALERT,
    targetUserIds,
    message: `Request #${requestId} needs your approval.`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}



export async function publishApprovalUpdate(
  requestId: string,
  studentUserIds: string[],
  approvedBy: string,
  nextLevel?: number // ✅ optional
) {
  const message = nextLevel
    ? `Your request #${requestId} was approved by ${approvedBy}. Forwarded to Level ${nextLevel} for further approval.`
    : `Your request #${requestId} was approved by ${approvedBy}.`;

  await sendToSQS(SQS_QUEUES.IMPORTANT!, {
    type: NotificationTypes.APPROVAL_UPDATE,
    targetUserIds: studentUserIds,
    message,
    requestId,
    nextLevel: nextLevel ?? null, // store null if not present
    timestamp: new Date().toISOString(),
  });
}



/**
 * ✅ Notify student that request is approved
 */
export async function publishFinalApproval(
  requestId: string,
  studentUserIds: string[]
) {
  await sendToSQS(SQS_QUEUES.IMPORTANT!, {
    type: NotificationTypes.REQUEST_APPROVED,
    targetUserIds: studentUserIds,
    message: `Your request #${requestId} has been fully approved ✅`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}


/**
 * ❌ Notify student that request is rejected
 */
export async function publishRequestRejected(
  requestId: string,
  studentUserIds: string[],
  reason?: string
) {
  await sendToSQS(SQS_QUEUES.IMPORTANT!, {
    type: NotificationTypes.REQUEST_REJECTED,
    targetUserIds: studentUserIds,
    message: reason
      ? `Your request #${requestId} was rejected ❌. Reason: ${reason}`
      : `Your request #${requestId} was rejected ❌.`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 📢 Notify student that their request was successfully withdrawn
 */
export async function publishRequestWithdrawn(
  requestId: string,
  studentUserIds: string[]
) {
  await sendToSQS(SQS_QUEUES.IMPORTANT!, {
    type: NotificationTypes.REQUEST_WITHDRAWN,
    targetUserIds: studentUserIds,
    message: `Request #${requestId} has been withdrawn by the student.`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
