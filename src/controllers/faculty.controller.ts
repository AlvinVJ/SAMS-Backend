import type { Request, Response } from "express";
import * as FacultyService from "../services/faculty.service.js";

export async function getRequestsToApprove(req: Request, res: Response) {
  try {
    const result = await FacultyService.getRequestsToApproveService({
      query: req.query,
      user: req.user
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getRequestsToApprove controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function approveRequest(req: Request, res: Response) {
  try {
    const result = await FacultyService.approveRequestService({
      body: req.body,
      user: req.user,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("approveRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export const getActedRequests = async (req: Request, res: Response) => {
  try {
    const result = await FacultyService.getActedRequestsService((req as any).user);
    res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("getActedRequests controller error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export const getDashboardData = async (req: Request, res: Response) => {
  try {
    const result = await FacultyService.getFacultyDashboardDataService((req as any).user, req.query);
    res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("getDashboardData controller error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}
export const getProfile = async (req: Request, res: Response) => {
  try {
    const result = await FacultyService.getFacultyProfileService((req as any).user);
    res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("getProfile controller error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const result = await FacultyService.getFacultyNotificationsService((req as any).user);
    res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("getNotifications controller error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}
