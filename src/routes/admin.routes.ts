import { Router } from "express";
import { 
  saveProcedure, 
  getProcedures, 
  getProcedureById, 
  updateProcedure, 
  deleteProcedure 
} from "../controllers/admin.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

// Procedure CRUD endpoints
adminRouter.post("/saveProcedure", saveProcedure);
adminRouter.get("/procedures", getProcedures);
adminRouter.get("/procedure/:id", getProcedureById);
adminRouter.put("/procedure/:id", updateProcedure);
adminRouter.delete("/procedure/:id", deleteProcedure);
