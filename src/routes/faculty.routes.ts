import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { getRequestsToApprove, approveRequest, getActedRequests } from "../controllers/faculty.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const facultyRouter = Router();

facultyRouter.use(requireAuth, requireRole("faculty"));

facultyRouter.get("/request_for_approval", getRequestsToApprove)
facultyRouter.get("/acted_requests", getActedRequests)
facultyRouter.post("/approve_request", approveRequest)
