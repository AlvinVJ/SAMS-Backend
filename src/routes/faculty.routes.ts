// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { getRequestsToApprove } from "../controllers/faculty.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const facultyRouter = Router();

facultyRouter.use(requireAuth, requireRole("faculty"));

facultyRouter.get("/request_for_approval", getRequestsToApprove)
