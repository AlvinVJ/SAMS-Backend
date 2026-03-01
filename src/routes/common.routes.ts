import { Router } from "express";
import { ping, signup, fetch_procedures, create_request, get_role_tags, search_faculty } from "../controllers/common.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireAuth } from "../middleware/requireAuth.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

export const commonRouter = Router();
commonRouter.use(requireAuth, requireRole("admin", "student", "faculty"));

commonRouter.get("/ping", ping);

commonRouter.post("/signup", signup);

commonRouter.get("/fetch_procedures", fetch_procedures);

commonRouter.post("/create_request", upload.single('file'), create_request);

commonRouter.get("/get_role_tags", get_role_tags);

commonRouter.post("/search_faculty", search_faculty);
