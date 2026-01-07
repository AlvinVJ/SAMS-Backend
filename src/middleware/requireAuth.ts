import type { Request, Response, NextFunction } from "express";
import { firebaseAuth } from "../config/firebase.js";
import { prisma } from "../db/prisma.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);

    const user = await prisma.userAccount.findFirst({
      where: { auth_uid: decoded.uid },
    });

    if (!user) {
      return res.status(403).json({ error: "User not registered" });
    }

    const roleMap: Record<number, "ADMIN" | "FACULTY" | "STUDENT"> = {
      2: "ADMIN",
      1: "FACULTY",
      0: "STUDENT",
    };

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      role: roleMap[user.user_type],
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}
