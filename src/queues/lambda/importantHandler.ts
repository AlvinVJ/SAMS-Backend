// src/queues/lambda/importantHandler.ts

import admin from "firebase-admin";
import { firestore, fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

/**
 * AWS Lambda Handler for SQS "Important" Queue
 */
export const handler = async (event: any) => {
    console.log("🚀 Lambda invoked for IMPORTANT Queue");

    for (const record of event.Records) {
        try {
            const payload = JSON.parse(record.body);
            console.log("\n🔥 IMPORTANT Notification Received:", payload);

            const { targetUserId, type, message, requestId } = payload;

            // ===================================================
            // STEP 1: Save to Firestore
            // ===================================================
            await firestore
                .collection("profiles")
                .doc(targetUserId)
                .collection("notifications")
                .add({
                    type: type,
                    message: message,
                    requestId: requestId ?? null,
                    isRead: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

            // ===================================================
            // STEP 2: FCM Push (Fixing the payload)
            // ===================================================
            const userTokens = await prisma.fCMTokens.findMany({
                where: { mits_uid: targetUserId },
                select: { fcm_token: true },
            });

            if (userTokens.length > 0) {
                const tokens = userTokens.map((t) => t.fcm_token);

                // ✅ FIXED PAYLOAD: Using proper title and message body
                const pushMessage = {
                    notification: {
                        title: "Action Required" + (requestId ? ` (Req #${requestId})` : ""),
                        body: message || "You have a new important update.",
                    },
                    data: {
                        type: typeof type === 'string' ? type : String(type),
                        url: requestId ? `/requests/${requestId}` : "/",
                    },
                    tokens: tokens,
                };

                const response = await fcm.sendEachForMulticast(pushMessage);

                console.log(`✅ Lambda: Sent ${response.successCount} push messages to ${targetUserId}.`);
                if (response.failureCount > 0) {
                    console.warn(`⚠️ Lambda: Failed to send ${response.failureCount} push messages.`);
                }
            } else {
                console.log(`🔕 No FCM tokens found for user ${targetUserId}. Skipping push.`);
            }

        } catch (error) {
            console.error("❌ Error processing SQS record:", error);
            // Depending on Lambda setup, throwing an error here will cause SQS to retry this specific message
            throw error;
        }
    }

    return { statusCode: 200, body: "Processed successfully" };
};
