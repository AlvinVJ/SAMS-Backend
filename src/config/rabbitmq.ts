// src/config/rabbitmq.ts

import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";

let connection: ChannelModel;
let channel: Channel;

// Queue names (centralized here)
export const QUEUES = {
  APPROVAL: "approval_queue",
  NOTIFICATION: "notification_queue",
};

// ✅ Connect RabbitMQ only once when server starts
export async function connectRabbitMQ() {
  try {
    connection = await amqp.connect("amqp://localhost");
    channel = await connection.createChannel();

    // Assert queues (creates them if they don’t exist)
    await channel.assertQueue(QUEUES.APPROVAL, { durable: true });
    await channel.assertQueue(QUEUES.NOTIFICATION, { durable: true });

    console.log("✅ RabbitMQ Connected Successfully!");
    console.log("Queues ready:", Object.values(QUEUES));
  } catch (error) {
    console.error("❌ RabbitMQ Connection Failed:", error);
    process.exit(1);
  }
}

// ✅ Helper: Send message to a queue
export function sendToQueue(queueName: string, data: object) {
  if (!channel) {
    throw new Error(
      "RabbitMQ channel not initialized. Call connectRabbitMQ() first."
    );
  }

  channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
    persistent: true,
  });

  console.log(`📩 Message sent to queue: ${queueName}`);
}

// ✅ Helper: Consume messages from a queue
export async function consumeQueue(
  queueName: string,
  callback: (msg: any) => void
) {
  if (!channel) {
    throw new Error(
      "RabbitMQ channel not initialized. Call connectRabbitMQ() first."
    );
  }

  await channel.consume(queueName, (msg) => {
    if (msg) {
      const content = JSON.parse(msg.content.toString());

      callback(content);

      // Acknowledge message after processing
      channel.ack(msg);
    }
  });

  console.log(`👂 Listening for messages on: ${queueName}`);
}
