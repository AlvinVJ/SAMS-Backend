// src/queues/workers/importantWorker.ts

import {
  connectRabbitMQ,
  consumeQueue,
  QUEUES,
} from "../../config/rabbitmq.js";
import admin from "firebase-admin";
import { firestore, fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

async function startImportantWorker() {
  // ✅ Connect to RabbitMQ first
  await connectRabbitMQ();

  console.log("🚀 Important Worker Started...");
  console.log("👂 Listening for messages on important_queue");

  // ✅ Consume IMPORTANT queue
  await consumeQueue(QUEUES.IMPORTANT, async (event) => {
    console.log("\n🔥 IMPORTANT Notification Received:");
    console.log(event);

    // ---------------------------------------------------
    // Write this notification into Firestore so that
    // user can see it later in Notifications page in the notifications section.
    await firestore
      .collection("profiles")
      .doc(event.targetUserId) // must match document ID exactly
      .collection("notifications")
      .add({
        type: event.type,
        message: event.message,
        requestId: event.requestId ?? null,
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    // ---------------------------------------------------



    // ===================================================
    // ✅ STEP 2 (FCM Push)
    // After saving in DB, send push notification via FCM.
    // ===================================================

    try {
      const targetUserId = event.targetUserId;
      const title = "New Important Notification";
      const body = event.message || "You have a new important update.";

      // 1. Fetch all FCM tokens for this user
      const userTokens = await prisma.fCMTokens.findMany({
        where: { mits_uid: targetUserId },
        select: { fcm_token: true },
      });

      if (userTokens.length > 0) {
        const tokens = userTokens.map((t: { fcm_token: string }) => t.fcm_token);

        // 2. Send multi-cast message to all user's devices
        const pushMessage = {
          notification: {
            title: title,
            body: body,
          },
          tokens: tokens,
        };

        const response = await fcm.sendEachForMulticast(pushMessage);
        console.log(`✅ Important Worker: Successfully sent ${response.successCount} push messages to ${targetUserId}.`);

        if (response.failureCount > 0) {
          console.warn(`⚠️ Important Worker: Failed to send ${response.failureCount} push messages.`);
        }
      } else {
        console.log(`🔕 No FCM tokens found for user ${targetUserId}. Skipping push notification.`);
      }
    } catch (pushError) {
      console.error("❌ Error sending push notification from Important Worker:", pushError);
    }

    console.log("✅ Processed important notification.");
  });
}

startImportantWorker();
