// src/queues/workers/pushWorker.ts

import {
  connectRabbitMQ,
  consumeQueue,
  QUEUES,
} from "../../config/rabbitmq.js";

import { fcm } from "../../config/firebase.js";
import { prisma } from "../../db/prisma.js";

async function startPushWorker() {
  // ✅ Connect first
  await connectRabbitMQ();

  console.log("🚀 Push Worker Started...");

  // ✅ Consume PUSH queue
  await consumeQueue(QUEUES.PUSH, async (event) => {
    console.log("🌱 PUSH Notification Received:");
    console.log(event);

    // Later: Send FCM only
  });
}

startPushWorker();
