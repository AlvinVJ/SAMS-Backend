import { Router } from "express";
import { ping, signup } from "../controllers/common.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const commonRouter = Router();
commonRouter.use(requireAuth, requireRole("admin", "student", "faculty"));

commonRouter.get("/ping", ping);

commonRouter.post("/signup", signup);
