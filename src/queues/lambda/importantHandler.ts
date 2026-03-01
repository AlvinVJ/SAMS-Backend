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

            // ===================================================
            // STEP 1: Save to Firestore (Batched)
            // ===================================================
            const batch = firestore.batch();
            const profilesRef = firestore.collection("profiles");

            for (const userId of userIds) {
                // Generate a new document reference in the notifications subcollection
                const docRef = profilesRef.doc(userId).collection("notifications").doc();
                batch.set(docRef, {
                    type: type,
                    message: message,
                    requestId: requestId ?? null,
                    isRead: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            await batch.commit();

            // ===================================================
            // STEP 2: FCM Push (Chunked Multicast)
            // ===================================================
            const userTokens = await prisma.fCMTokens.findMany({
                where: { mits_uid: { in: userIds } },
                select: { fcm_token: true },
            });

            if (userTokens.length > 0) {
                const rawTokens = userTokens.map((t) => t.fcm_token);
                const uniqueTokens = Array.from(new Set(rawTokens));
                console.log(`📋 Found ${rawTokens.length} total tokens, ${uniqueTokens.length} unique tokens for users:`, userIds);
                console.log(`🔑 Tokens being targeted:`, uniqueTokens);

                const tokens = uniqueTokens;

                const baseMessage = {
                    notification: {
                        title: "Action Required" + (requestId ? ` (Req #${requestId})` : ""),
                        body: message || "You have a new important update.",
                    },
                    data: {
                        type: typeof type === 'string' ? type : String(type),
                        url: requestId ? `/requests/${requestId}` : "/",
                    },
                };

                const chunkSize = 500;
                let successCount = 0;
                let failureCount = 0;

                for (let i = 0; i < tokens.length; i += chunkSize) {
                    const chunk = tokens.slice(i, i + chunkSize);
                    const pushMessage = { ...baseMessage, tokens: chunk };
                    const response = await fcm.sendEachForMulticast(pushMessage);

                    successCount += response.successCount;
                    failureCount += response.failureCount;
                }

                console.log(`✅ Lambda: Sent ${successCount} push messages to ${userIds.length} users.`);
                if (failureCount > 0) {
                    console.warn(`⚠️ Lambda: Failed to send ${failureCount} push messages.`);
                }
            } else {
                console.log(`🔕 No FCM tokens found for the ${userIds.length} requested users. Skipping push.`);
            }

        } catch (error) {
            console.error("❌ Error processing SQS record:", error);
            // Depending on Lambda setup, throwing an error here will cause SQS to retry this specific message
            throw error;
        }
    }

    return { statusCode: 200, body: "Processed successfully" };
};
