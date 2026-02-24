// src/config/rabbitmq.ts

import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";

let connection: ChannelModel;
let channel: Channel;

// ✅ Queue names (Priority-based)
export const QUEUES = {
  IMPORTANT: "important_queue", // High priority alerts (approvals, request updates)
  PUSH: "push_queue", // Low priority push-only notifications
};

// ✅ Connect RabbitMQ only once when server starts
export async function connectRabbitMQ() {
  try {
    connection = await amqp.connect("amqp://localhost");
    channel = await connection.createChannel();

    channel.prefetch(1);

    // ✅ Assert queues (creates them if they don’t exist)
    await channel.assertQueue(QUEUES.IMPORTANT, { durable: true });
    await channel.assertQueue(QUEUES.PUSH, { durable: true });

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
    persistent: true, // ensures message survives broker restart
  });

  console.log(`📩 Message sent to queue: ${queueName}`);
}

// ✅ Helper: Consume messages from a queue (SAFE ACK)
export async function consumeQueue(
  queueName: string,
  callback: (msg: any) => Promise<void>
) {
  if (!channel) {
    throw new Error(
      "RabbitMQ channel not initialized. Call connectRabbitMQ() first."
    );
  }

  await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    const content = JSON.parse(msg.content.toString());

    try {
      // ✅ Wait until processing finishes
      await callback(content);

      // ✅ Ack ONLY after successful processing
      channel.ack(msg);

      console.log(`✅ Message processed + acked from: ${queueName}`);
    } catch (error) {
      console.error(`❌ Error processing message from ${queueName}:`, error);

      // ❌ Do NOT ack → message will retry later
      // Optional retry behavior:
      // channel.nack(msg, false, true);
    }
  });

  console.log(`👂 Listening for messages on: ${queueName}`);
}
