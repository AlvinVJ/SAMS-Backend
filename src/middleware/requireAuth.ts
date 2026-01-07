import type { NextFunction } from "express";
import { firebaseAuth } from "../config/firebase.js";
import { prisma } from "../db/prisma.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {

  if (req.method === "OPTIONS") {
    return next();
  }

  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);

    const user = await prisma.userAccount.findFirst({where: {clerk_uid: decoded.uid}});

    if (!user) {
      return res.status(403).json({ error: "User not registered" });
    }
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      role: (user.user_type==0)?"ADMIN":"STUDENT",
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}