// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";

export const studentRouter = Router();

studentRouter.use(requireRole("ADMIN"));

studentRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Admin dashboard" });
});
