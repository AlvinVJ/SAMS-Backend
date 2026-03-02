import type { Request, Response, NextFunction } from "express";
import { firebaseAuth } from "../config/firebase.js";
import { prisma } from "../db/prisma.js";

type AppRole = "admin" | "faculty" | "student";

function isStudentEmail(email: string): boolean {
  return /^\d+[a-zA-Z]+\d+@mgits\.ac\.in$/.test(email);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization header not found or invalid" });
  }

  const token = header.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Token not found" });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    const email = decoded.email;

    if (!email) {
      return res.status(403).json({ error: "Invalid user credentials: email missing" });
    }

    const emailPrefix = email.split("@")[0]!;

    // 1️⃣ Fetch User Account from SQL (Single source of truth)
    const userAccount = await prisma.userAccount.findFirst({
      where: {
        OR: [
          { auth_uid: decoded.uid },
          { email: email }
        ],
        is_active: true,
        deleted_at: null
      },
      include: {
        UserTypes: true
      }
    });

    let role: AppRole;
    let mits_uid: string;

    if (userAccount) {
      mits_uid = userAccount.mits_uid;
      const typeTag = userAccount.UserTypes.user_type_tag.toUpperCase();

      if (typeTag === "ADMIN") role = "admin";
      else if (typeTag === "FACULTY") role = "faculty";
      else role = "student";
    } else {
      // 2️⃣ Fallback: Check if they are pre-imported in Student or Faculty tables (First-time signup)
      const isStudent = isStudentEmail(email);
      const facultyWhitelist = await prisma.faculty.findUnique({ where: { mits_uid: emailPrefix } });

      if (isStudent) {
        role = "student";
        mits_uid = emailPrefix;
      } else if (facultyWhitelist) {
        role = "faculty";
        mits_uid = emailPrefix;
      } else {
        // Non-students MUST be whitelisted as faculty in SQL to proceed
        return res.status(403).json({ error: "User not whitelisted in system" });
      }
    }

    req.user = {
      uid: decoded.uid,
      email: email,
      role: role,
      mits_uid: mits_uid
    };

    next();
  } catch (err) {
    console.error("requireAuth evaluation error:", err);
    return res.status(401).json({ error: "Invalid token or session" });
  }
}
