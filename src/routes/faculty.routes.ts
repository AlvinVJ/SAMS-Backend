import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { getRequestsToApprove, approveRequest, getActedRequests, getDashboardData, getProfile, getNotifications } from "../controllers/faculty.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const facultyRouter = Router();

facultyRouter.use(requireAuth, requireRole("faculty"));

facultyRouter.get("/dashboard", getDashboardData)
facultyRouter.get("/profile", getProfile)
facultyRouter.get("/notifications", getNotifications)
facultyRouter.get("/request_for_approval", getRequestsToApprove)
facultyRouter.get("/acted_requests", getActedRequests)
facultyRouter.post("/approve_request", approveRequest)
