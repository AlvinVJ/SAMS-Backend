// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";

export const facultyRouter = Router();

facultyRouter.use(requireRole("faculty"));

facultyRouter.get("/dashboard", (req, res) => {
  res.json({ message: "Admin dashboard" });
});
