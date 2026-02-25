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

export async function fetch_procedures(req: Request, res: Response) {
  try {
    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await CommonService.fetch_procedures({
      // headers: {
      //   authorization: authHeader,
      // },
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("fetch_procedures controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function create_request(req: Request, res: Response) {
  try {
    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await CommonService.create_request({
      // headers: {
      //   authorization: authHeader,
      // },
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("create_request controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function get_role_tags(req: Request, res: Response) {
  try {
    const authHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const result = await CommonService.getRoleTags({
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

export async function save_fcm_token(req: Request, res: Response) {
  try {
    const result = await CommonService.saveFCMToken({
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("save_fcm_token controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}