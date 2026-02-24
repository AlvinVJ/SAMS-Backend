// src/queues/workers/importantWorker.ts

import {
  connectRabbitMQ,
  consumeQueue,
  QUEUES,
} from "../../config/rabbitmq.js";
import admin from "firebase-admin";
import { firestore } from "../../config/firebase.js";

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
    // ✅ STEP 2 (FCM Push - Optional)
    // After saving in DB, send push notification via FCM.
    //
    // Example (TO BE IMPLEMENTED):
    //
    // 1. Fetch user device token from DB/Firestore
    // 2. Send push using Firebase Admin SDK:
    //
    // await admin.messaging().send({
    //   token: userDeviceToken,
    //   notification: {
    //     title: "New Notification",
    //     body: event.message,
    //   },
    // });
    //
    // ===================================================



    console.log("✅ Processed important notification.");
  });
}

startImportantWorker();
