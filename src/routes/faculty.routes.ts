// src/routes/admin.routes.ts
import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { getRequest } from "../controllers/faculty.controller.js";

export const facultyRouter = Router();

facultyRouter.use(requireRole("faculty"));

facultyRouter.get("/request_for_approval", getRequest)
