// src/queues/producers/importantProducer.ts

import { sendToQueue, QUEUES } from "../../config/rabbitmq.js";
import { NotificationTypes } from "../event.js";

/**
 * Publish an important notification (approval/request related)
 */
export function publishApprovalAlert(requestId: string, targetUserId: string) {
  sendToQueue(QUEUES.IMPORTANT, {
    type: NotificationTypes.APPROVAL_ALERT,
    targetUserId,
    message: `Request #${requestId} needs your approval.`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}



export function publishApprovalUpdate(
  requestId: string,
  studentUserId: string,
  approvedBy: string,
  nextLevel?: number // ✅ optional
) {
  const message = nextLevel
    ? `Your request #${requestId} was approved by ${approvedBy}. Forwarded to Level ${nextLevel} for further approval.`
    : `Your request #${requestId} was approved by ${approvedBy}.`;

  sendToQueue(QUEUES.IMPORTANT, {
    type: NotificationTypes.APPROVAL_UPDATE,
    targetUserId: studentUserId,
    message,
    requestId,
    nextLevel: nextLevel ?? null, // store null if not present
    timestamp: new Date().toISOString(),
  });
}



/**
 * ✅ Notify student that request is approved
 */
export function publishFinalApproval(
  requestId: string,
  studentUserId: string
) {
  sendToQueue(QUEUES.IMPORTANT, {
    type: NotificationTypes.REQUEST_APPROVED,
    targetUserId: studentUserId,
    message: `Your request #${requestId} has been fully approved ✅`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}


/**
 * ❌ Notify student that request is rejected
 */
export function publishRequestRejected(
  requestId: string,
  studentUserId: string,
  reason?: string
) {
  sendToQueue(QUEUES.IMPORTANT, {
    type: NotificationTypes.REQUEST_REJECTED,
    targetUserId: studentUserId,
    message: reason
      ? `Your request #${requestId} was rejected ❌. Reason: ${reason}`
      : `Your request #${requestId} was rejected ❌.`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
