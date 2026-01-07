import type { Request, Response } from "express";
import * as CommonService from "../services/common.service.js";


export async function ping(
  _req: Request,
  res: Response
) {
  return res.status(200).json({
    status: "ok",
    message: "pong",
    timestamp: new Date().toISOString(),
  });
}


export async function signup(req: Request, res: Response) {
  try {

    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await CommonService.signup({
      headers: {
        authorization: authHeader,
      },
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("Signup controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}