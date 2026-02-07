import type { Request, Response } from "express";
import * as FacultyService from "../services/faculty.service.js";

export async function getRequestsToApprove(req: Request, res: Response) {
  try {
    const authHeader = 
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await FacultyService.getRequestsToApproveService({
      headers: { authorization: authHeader },
      query: req.query, 
      user: req.user
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err: any) {
    console.error("getRequestsToApprove controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function approveRequest(req: Request, res: Response) {
  try {
    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await FacultyService.approveRequestService({
      headers: { authorization: authHeader },
      body: req.body,
      user: req.user,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err: any) {
    console.error("approveRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function rejectRequest(req: Request, res: Response) {
  try {
    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await FacultyService.rejectRequestService({
      headers: { authorization: authHeader },
      body: req.body,
      user: req.user,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err: any) {
    console.error("rejectRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
