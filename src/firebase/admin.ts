import admin from 'firebase-admin';
import serviceAccount from './serviceAccountKeys.json' with { type: 'json' };
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const firebaseAuth: Auth = admin.auth();
export const firestore: Firestore = admin.firestore();
export const fcm: Messaging = admin.messaging();

