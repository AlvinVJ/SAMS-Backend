import { Router } from "express";
import { saveProcedure } from "../controllers/admin.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.post("/saveProcedure", saveProcedure);