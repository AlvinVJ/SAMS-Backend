import type { Request, Response } from "express";
import * as FacultyService from "../services/faculty.service.js";

export async function getRequest(
    req: Request,
    res: Response
) {
    const authHeader = 
    typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : undefined;

      const result = await FacultyService.getReqApp({
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