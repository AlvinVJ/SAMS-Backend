import { Router } from "express";
import { ping, signup } from "../controllers/common.controller.js";

export const commonRouter = Router();

commonRouter.get("/ping", ping);

commonRouter.post("/signup", signup);
