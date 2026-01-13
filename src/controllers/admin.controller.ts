import type { Request, Response } from "express";
import * as AdminService from "../services/admin.service.js";

export async function saveProcedure(
  req: Request,
  res: Response
) {

  const authHeader = 
    typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : undefined;

  const result = await AdminService.saveProcedureDef({
    headers: {
      authorization: authHeader,
    },
    body: req.body,
    user: req.user
  });
  return res.status(result.statusCode).json({
    success: result.success,
    message: result.message,
    data: result.data ?? null,
  });
}
