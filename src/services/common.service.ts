import { prisma } from "../db/prisma.js";
import admin from "../config/firebase.js";
import {firebaseAuth, firestore} from "../config/firebase.js";


interface SignupResult {
    success: boolean;
    statusCode: number;
    message: string;
    data?: any;

}
interface SignupPayload {
    headers: {
        authorization?: string | undefined;
    };
    body: any;
}

export async function signup(payload: SignupPayload): Promise<SignupResult> {
    try {
        const authHeader = payload.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return {
                success: false,
                statusCode: 401,
                message: "Missing or invalid Authorization header",
            };
        }

        const idToken = authHeader.split(" ")[1]!;

        const decodedToken = await firebaseAuth.verifyIdToken(idToken);
        const { uid, email } = decodedToken;

        if (!email) {
            return {
                success: false,
                statusCode: 400,
                message: "Email not found in token",
            };
        }
        const emailPrefix = email.split('@')[0];
        if (!emailPrefix) {
            return {
                success: false,
                statusCode: 400,
                message: "Invalid email prefix",
            };
        }

        const db = firestore;
        const userDetailsSnap = await db
            .collection("userDetails").doc(emailPrefix).get();
        if (!userDetailsSnap.exists) {
            return {
                success: false,
                statusCode: 403,
                message: "User not authorized to sign up",
            };
        }
        const userData = userDetailsSnap.data()!;

        const profileRef = db.collection("profiles").doc(emailPrefix);
        const profileSnap = await profileRef.get();

        if (!profileSnap.exists) {
            await profileRef.set({
                banned: false,
                email: decodedToken.email,
                isActive: "active",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                role: userData.role,
                uid: emailPrefix.toUpperCase()
            });
        }

        const existingUser = await prisma.userAccount.findUnique({
            where: { mits_uid: emailPrefix },
        });

        if (!existingUser) {
            let userType;
            if (userData.role == "admin") {
                userType = 0;
            }
            else if (userData.role == "faculty") {
                userType = 1;
            }
            else if (userData.role == "student") {
                userType = 2;
            }
            else {
                return {
                    success: false,
                    statusCode: 403,
                    message: "invalid credentials initialized in whitelist table",
                };
            }
            await prisma.userAccount.create({
                data: {
                    auth_uid: uid,
                    mits_uid: emailPrefix,
                    user_type: userType
                },
            });
            return {
                success: true,
                statusCode: 201,
                message: "User signed up successfully",
                data: {
                    uid,
                    email,
                    role: userData.role,
                },
            };
        }
        else {
            return {
                success: true,
                statusCode: 200,
                message: "User already exists",
                data: {
                    uid,
                    email,
                    role: userData.role,
                },
            };

        }
    } catch (error) {
        console.error("Signup service error:", error);

        return {
            success: false,
            statusCode: 500,
            message: "Internal server error",
        };
    }

}