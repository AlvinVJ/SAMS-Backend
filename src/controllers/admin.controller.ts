import type { Request, Response } from "express";
import * as AdminService from "../services/admin.service.js";

export async function getAdminDashboard(
  req: Request,
  res: Response
) {
  const stats = await AdminService.getDashboardStats();

  return res.status(200).json({
    status: "success",
    data: stats,
  });
}
