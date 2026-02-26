import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// 1. Initialize the SQS Client
// Make sure you have AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in your .env
export const sqsClient = new SQSClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    }
});

// 2. Define your SQS Queue URLs
// You will need to create these SQS queues in your AWS Console and paste their URLs here (or in .env)
export const SQS_QUEUES = {
    IMPORTANT: process.env.SQS_IMPORTANT_QUEUE_URL || "https://sqs.us-east-1.amazonaws.com/123456789012/important_queue",
    PUSH: process.env.SQS_PUSH_QUEUE_URL || "https://sqs.us-east-1.amazonaws.com/123456789012/push_queue",
};

// 3. Helper: Send message to an SQS Queue
export async function sendToSQS(queueUrl: string, data: object) {
    if (!queueUrl) {
        throw new Error("SQS queueUrl is not defined.");
    }

    const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(data),
        // Optional: Add a MessageGroupId if using a FIFO queue
    });

    try {
        const response = await sqsClient.send(command);
        console.log(`📩 Message sent to SQS queue: ${queueUrl} (MessageId: ${response.MessageId})`);
        return response;
    } catch (error) {
        console.error(`❌ SQS Send Error for queue ${queueUrl}:`, error);
        throw error;
    }
}
