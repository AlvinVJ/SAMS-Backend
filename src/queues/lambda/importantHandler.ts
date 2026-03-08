// src/queues/lambda/importantHandler.ts

import admin from "firebase-admin";
import { firestore, fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

/**
 * AWS Lambda Handler for SQS "Important" Queue
 */
export const handler = async (event: any, context: any) => {
    // Freeze the Lambda instantly upon return (don't wait for Prisma/Firebase sockets to close)
    context.callbackWaitsForEmptyEventLoop = false;

    console.log("🚀 Lambda invoked for IMPORTANT Queue");

    for (const record of event.Records) {
        try {
            const payload = JSON.parse(record.body);
            console.log(`\n🔥 IMPORTANT Notification Received. MessageID: ${record.messageId} | Payload:`, payload);

            const { targetUserId, targetUserIds, type, message, requestId } = payload;

            // Fallback for backward compatibility
            const userIds: string[] = targetUserIds || (targetUserId ? [targetUserId] : []);

            if (userIds.length === 0) {
                console.log("🔕 No target users specified. Skipping.");
                continue;
            }

            for (const userId of userIds) {
                try {
                    // ===================================================
                    // STEP 1: Save to Firestore per user
                    // ===================================================
                    const docRef = firestore.collection("profiles").doc(userId).collection("notifications").doc();
                    await docRef.set({
                        type: type,
                        message: message,
                        requestId: requestId ?? null,
                        isRead: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // ===================================================
                    // STEP 2: FCM Push for this user
                    // ===================================================
                    const userTokens = await prisma.fCMTokens.findMany({
                        where: { mits_uid: userId },
                        select: { fcm_token: true },
                    });

                    if (userTokens.length > 0) {
                        const rawTokens = userTokens.map((t) => t.fcm_token);
                        const uniqueTokens = Array.from(new Set(rawTokens));
                        console.log(`📋 Found ${uniqueTokens.length} unique tokens for user: ${userId}`);

                        const pushMessage = {
                            notification: {
                                title: "Action Required" + (requestId ? ` (Req #${requestId})` : ""),
                                body: message || "You have a new important update.",
                            },
                            data: {
                                type: typeof type === 'string' ? type : String(type),
                                url: requestId ? `/requests/${requestId}` : "/",
                            },
                            tokens: uniqueTokens,
                        };

                        try {
                            const response = await fcm.sendEachForMulticast(pushMessage);

                            if (response.failureCount > 0) {
                                const failedTokens: string[] = [];

                                response.responses.forEach((resp, idx) => {
                                    if (!resp.success && resp.error) {
                                        const errCode = resp.error.code;
                                        const failedToken = uniqueTokens[idx] as string;
                                        if (errCode === 'messaging/registration-token-not-registered' || errCode === 'messaging/invalid-registration-token') {
                                            failedTokens.push(failedToken);
                                        } else {
                                            console.warn(`⚠️ Other FCM Error for token ${failedToken}:`, resp.error);
                                        }
                                    }
                                });

                                if (failedTokens.length > 0) {
                                    console.log(`🗑️ Deleting ${failedTokens.length} invalid/unregistered FCM tokens for user ${userId}.`);
                                    await prisma.fCMTokens.deleteMany({
                                        where: {
                                            fcm_token: { in: failedTokens }
                                        }
                                    });
                                }
                            }
                            console.log(`✅ Lambda: Sent ${response.successCount} push messages to user ${userId}.`);
                        } catch (fcmError) {
                            console.error(`❌ FCM Cluster Error when sending push to user ${userId}:`, fcmError);
                        }
                    } else {
                        console.log(`🔕 No FCM tokens found for user ${userId}. Skipping push.`);
                    }

                } catch (userError) {
                    console.error(`❌ Error processing notification for user ${userId}:`, userError);
                    // Do not throw! Continue to the next user in the array.
                }
            }

        } catch (error) {
            console.error("❌ Error processing SQS record:", error);
            // Depending on Lambda setup, throwing an error here will cause SQS to retry this specific message
            throw error;
        }
    }

    return { statusCode: 200, body: "Processed successfully" };
};
