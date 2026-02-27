import { Router } from "express";
import { createRequest, getMyRequests, getStudentDashboardData, withdrawRequest, getRequestDetails } from "../controllers/requests.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";

export const requestsRouter = Router();

requestsRouter.post(
  "/create",
  requireAuth,
  requireRole("student"),
  createRequest
);

requestsRouter.get(
  "/my_requests",
  requireAuth,
  requireRole("student"),
  getMyRequests
);

requestsRouter.get(
  "/details/:reqId",
  requireAuth,
  requireRole("student"),
  getRequestDetails
);

requestsRouter.get(
  "/dashboard_data",
  requireAuth,
  requireRole("student"),
  getStudentDashboardData
);

requestsRouter.delete(
  "/withdraw/:requestId",
  requireAuth,
  requireRole("student"),
  withdrawRequest
);

