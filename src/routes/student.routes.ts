// src/routes/admin.routes.ts
import { Router } from "express";
import type { Request, Response } from "express";
import * as StudentService from "../services/student.service.js";
import { prisma } from "../db/prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as StudentController from "../controllers/student.controller.js";
export const studentRouter = Router();

studentRouter.use(requireAuth, requireRole("student"));

studentRouter.get("/profile", StudentController.getProfile);
studentRouter.get("/notifications", StudentController.getNotifications);

studentRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Student dashboard" });
});
