import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from '../config/firebase.js';
import type { Request, Response, NextFunction } from "express";

export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const idToken = authHeader.split(' ')[1]!;

  try {
    const decoded: DecodedIdToken = await firebaseAuth.verifyIdToken(idToken);

    // Attach Firebase user to request
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email,
      claims: decoded,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
