// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/auth.js";

export const helperRouter = Router();

helperRouter.use(requireRole("ADMIN"));

helperRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Admin dashboard" });
});
