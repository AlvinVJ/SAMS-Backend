// src/queues/lambda/pushHandler.ts

import { fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

/**
 * AWS Lambda Handler for SQS "Push" Queue
 */
export const handler = async (event: any) => {
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

                const response = await fcm.sendEachForMulticast(pushMessage);

                console.log(`✅ Lambda: Sent ${response.successCount} push messages to ${targetUserId}.`);
                if (response.failureCount > 0) {
                    console.warn(`⚠️ Lambda: Failed to send ${response.failureCount} push messages.`);
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
