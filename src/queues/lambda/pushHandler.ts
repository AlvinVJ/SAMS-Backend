// src/queues/lambda/pushHandler.ts

import { fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

/**
 * AWS Lambda Handler for SQS "Push" Queue
 */
export const handler = async (event: any, context: any) => {
    // Freeze the Lambda instantly upon return (don't wait for Prisma/Firebase sockets to close)
    context.callbackWaitsForEmptyEventLoop = false;

    console.log("🚀 Lambda invoked for PUSH Queue");

    for (const record of event.Records) {
        try {
            const payload = JSON.parse(record.body);
            console.log("🌱 PUSH Notification Received:", payload);

            const { targetUserId, title, message, url } = payload;

            // ===================================================
            // Only FCM Push (No Firestore Save)
            // ===================================================
            const userTokens = await prisma.fCMTokens.findMany({
                where: { mits_uid: targetUserId },
                select: { fcm_token: true },
            });

            if (userTokens.length > 0) {
                const tokens = userTokens.map((t) => t.fcm_token);

                // ✅ FIXED PAYLOAD
                const pushMessage = {
                    notification: {
                        title: title || "New Notification",
                        body: message || "You have a new update.",
                    },
                    data: {
                        url: url || "/",
                    },
                    tokens: tokens,
                };

                try {
                    const response = await fcm.sendEachForMulticast(pushMessage);

                    console.log(`✅ Lambda: Sent ${response.successCount} push messages to ${targetUserId}.`);

                    if (response.failureCount > 0) {
                        console.warn(`⚠️ Lambda: Encountered ${response.failureCount} push failures inside payload.`);
                        const failedTokens: string[] = [];

                        response.responses.forEach((resp, idx) => {
                            if (!resp.success && resp.error) {
                                const errCode = resp.error.code;
                                const failedToken = tokens[idx] as string;
                                if (errCode === 'messaging/registration-token-not-registered' || errCode === 'messaging/invalid-registration-token') {
                                    failedTokens.push(failedToken);
                                } else {
                                    console.warn(`⚠️ Other FCM Error for token ${failedToken}:`, resp.error);
                                }
                            }
                        });

                        if (failedTokens.length > 0) {
                            console.log(`🗑️ Deleting ${failedTokens.length} invalid/unregistered FCM tokens from database.`);
                            await prisma.fCMTokens.deleteMany({
                                where: {
                                    fcm_token: { in: failedTokens }
                                }
                            });
                        }
                    }
                } catch (fcmError) {
                    // Global FCM failure, log it safely so SQS queue ACKs!
                    console.error(`❌ FCM Cluster Error when sending payload.`, fcmError);
                }
            } else {
                console.log(`🔕 No FCM tokens found for user ${targetUserId}. Skipping push.`);
            }

        } catch (error) {
            console.error("❌ Error processing SQS record in Push Queue:", error);
            throw error;
        }
    }

    return { statusCode: 200, body: "Processed successfully" };
};
