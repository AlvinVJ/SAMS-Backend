import { Router } from "express";
import {
  saveProcedure,
  getProcedures,
  getProcedureById,
  updateProcedure,
  deleteProcedure,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  getClasses,
  createClass,
  updateClass,
  deleteClass,
  getUsers,
  updateUser,
  getRoles,
  getGlobalRequests,
  getAdminDashboardStats,
  bulkImportAcademic,
  bulkImportUsers
} from "../controllers/admin.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";
import multer from "multer";

const upload = multer({ dest: "uploads/" });

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

// Procedure CRUD endpoints
adminRouter.post("/saveProcedure", saveProcedure);
adminRouter.get("/procedures", getProcedures);
adminRouter.get("/procedure/:id", getProcedureById);
adminRouter.put("/procedure/:id", updateProcedure);
adminRouter.delete("/procedure/:id", deleteProcedure);

// Departments
adminRouter.get("/departments", getDepartments);
adminRouter.post("/department", createDepartment);
adminRouter.put("/department", updateDepartment);
adminRouter.delete("/department/:id", deleteDepartment);

// Batches
adminRouter.get("/batches", getBatches);
adminRouter.post("/batch", createBatch);
adminRouter.put("/batch", updateBatch);
adminRouter.delete("/batch/:id", deleteBatch);

// Classes
adminRouter.get("/classes", getClasses);
adminRouter.post("/class", createClass);
adminRouter.put("/class", updateClass);
adminRouter.delete("/class/:id", deleteClass);

// Users
adminRouter.get("/users", getUsers);
adminRouter.put("/user/:id", updateUser);
adminRouter.get("/roles", getRoles);

// Global Monitoring
adminRouter.get("/global-requests", getGlobalRequests);
adminRouter.get("/dashboard-stats", getAdminDashboardStats);

// Bulk Import
adminRouter.post("/bulk-import-academic", upload.single("file"), bulkImportAcademic);
adminRouter.post("/bulk-import-users", upload.single("file"), bulkImportUsers);
