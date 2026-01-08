// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const helperRouter = Router();

helperRouter.use(requireAuth, requireRole("admin", "student", "faculty"));

helperRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Admin dashboard" });
});
