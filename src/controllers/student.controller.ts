import type { Request, Response } from "express";
import * as StudentService from "../services/student.service.js";
import { prisma } from "../db/prisma.js";

export async function getProfile(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const profile = await StudentService.getStudentProfile(user.uid);
  if (!profile) {
    return res.status(404).json({ success: false, message: "Profile not found" });
  }

  return res.json({
    success: true,
    data: {
      ...profile,
      email: user.email
    }
  });
}

export async function getNotifications(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const userAccount = await prisma.userAccount.findUnique({ where: { auth_uid: user.uid } });
  if (!userAccount) {
    return res.status(404).json({ success: false, message: "User account not found" });
  }

  const notifications = await StudentService.getNotifications(userAccount.mits_uid);
  return res.json({ success: true, data: notifications });
}
