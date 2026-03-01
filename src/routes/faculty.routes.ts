import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import {
    getRequestsToApprove,
    approveRequest,
    rejectRequest,
    getActedRequests,
    getDashboardData,
    getProfile,
    getNotifications,
} from "../controllers/faculty.controller.js";
import { bulkImportPlacementAttendance } from "../controllers/admin.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import multer from "multer";

const upload = multer({ dest: "uploads/" });

export const facultyRouter = Router();

facultyRouter.use(requireAuth, requireRole("faculty"));

facultyRouter.get("/dashboard", getDashboardData);
facultyRouter.get("/profile", getProfile);
facultyRouter.get("/notifications", getNotifications);
facultyRouter.get("/request_for_approval", getRequestsToApprove);
facultyRouter.get("/acted_requests", getActedRequests);
facultyRouter.post("/approve_request", approveRequest);
facultyRouter.post("/reject_request", rejectRequest);

// Bulk Placement Attendance (Moved from admin to faculty for Placement Coordinators)
facultyRouter.post(
    "/bulk-placement-attendance",
    upload.single("file"),
    bulkImportPlacementAttendance
);
