import { Router } from "express";
import { getAdminDashboard } from "../controllers/admin.controller.js";
import { requireRole } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireRole("ADMIN"));

adminRouter.get("/dashboard", getAdminDashboard);
