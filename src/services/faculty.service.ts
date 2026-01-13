import { prisma } from "../db/prisma.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import admin from "../config/firebase.js";

interface Result {
    success: boolean;
    statusCode: number;
    message: string;
    data?: any;
}

interface inputPayload {
    headers: {
        authorization?: string | undefined;
    };
    body: {
        procedure?: any;
    };
    user: any;
}

export async function getReqApp(payload: inputPayload): Promise<Result> {
    
}