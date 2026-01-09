import type { Request, Response, NextFunction } from "express";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { prisma } from "../db/prisma.js";

type AppRole = "admin" | "faculty" | "student";

function isStudentEmail(email: string): boolean {
  return /^\d+[a-zA-Z]+\d+@mgits\.ac\.in$/.test(email);
}

async function fetchRoleFromFirebase(uid: string): Promise<AppRole> {
  const doc = await firestore.collection("userDetails").doc(uid).get();

  if (!doc.exists) {
    throw new Error("User not whitelisted");
  }

  const role = doc.data()?.role;

  if (role ==null) {
    throw new Error("Invalid role in userDetails");
  }

  return role as AppRole;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if(header==null){
    return res.status(401).json({ error: "Authorization header not found" });

  }
  if (!header?.startsWith("Bearer ")) {
    return res.status(402).json({ error: "Missing token" });
  }

  const token = header.split(" ")[1];
  if(token==null){
    return res.status(401).json({ error: "Authorization header not found" });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);

    const email = decoded.email;
    if (email==null) {
      return res.status(403).json({ error: "Invalid user credentials" });
    }

    let role: AppRole;
    let emailPrefix = email.split("@")[0]!;

    // 1️⃣ Student detection
    if (isStudentEmail(email)) {
      role ="student";
    } 
    // 2️⃣ Faculty / Admin from Firebase whitelist
    else {
      role = await fetchRoleFromFirebase(emailPrefix);
    }

    // OPTIONAL but strongly recommended:
    // persist / fetch from DB instead of recomputing every time
    // const user = await prisma.userAccount.findFirst(...)

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      role,
      mits_uid: emailPrefix
    };

    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: "Invalid token" });
  }
}
