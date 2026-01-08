// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";
export const studentRouter = Router();

studentRouter.use(requireAuth, requireRole("student"));

studentRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Admin dashboard" });
});
