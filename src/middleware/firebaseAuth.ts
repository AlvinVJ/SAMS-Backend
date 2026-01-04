import { firebaseAuth } from '../firebase/admin.js';

export async function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const idToken = authHeader.split(' ')[1];

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);

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
