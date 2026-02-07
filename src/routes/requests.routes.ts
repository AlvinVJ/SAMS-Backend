import { Router } from "express";
import { createRequest } from "../controllers/requests.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";

export const requestsRouter = Router();

// REMOVE THIS LINE: queries like OPTIONS were failing here
// requestsRouter.use(requireAuth); 

// ADD requireAuth directly to the route instead:
requestsRouter.post(
  "/create", 
  requireAuth,           // <--- Auth check happens here
  requireRole("student"), 
  createRequest
);
