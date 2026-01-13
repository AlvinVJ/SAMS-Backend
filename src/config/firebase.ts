import admin, { type ServiceAccount } from "firebase-admin";
import serviceAccount from "../../serviceAccountKeys.json" with { type: "json" };
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as ServiceAccount),
  });
}

export const firebaseAuth: Auth = admin.auth();
export const firestore: Firestore = admin.firestore();
export const fcm: Messaging = admin.messaging();

export default admin;
