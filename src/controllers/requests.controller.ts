import type { Request, Response } from "express";
import * as RequestsService from "../services/requests.service.js";

export async function createRequest(req: Request, res: Response) {
  try {
    const result = await RequestsService.createRequest({
      body: req.body,
      user: req.user,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("createRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getMyRequests(req: Request, res: Response) {
  try {
    const result = await RequestsService.getMyRequests(req.user);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getMyRequests controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getStudentDashboardData(req: Request, res: Response) {
  try {
    const result = await RequestsService.getStudentDashboardData(req.user);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getStudentDashboardData controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
