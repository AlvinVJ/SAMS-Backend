import { Router } from "express";
import { ping } from "../controllers/common.controller.js";

export const commonRouter = Router();

commonRouter.get("/ping", ping);
