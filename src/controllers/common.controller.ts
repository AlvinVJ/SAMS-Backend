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

export async function search_faculty(req: Request, res: Response) {
  try {
    const result = await CommonService.searchFaculty({
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("search_faculty controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function fetch_procedures(req: Request, res: Response) {
  try {
    const result = await CommonService.fetch_procedures({
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
    const result = await CommonService.create_request({
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
    console.error("get_role_tags controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}