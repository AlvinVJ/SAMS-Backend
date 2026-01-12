import type { Request, Response } from "express";
import * as HelperService from "../services/helper.service.js";

export async function fetch_roles(req: Request, res: Response) {
  try {
    const result = await HelperService.fetch_roles({
      user: req.user,
      body: {
        search: typeof req.query.search === "string" ? req.query.search : "",
      },
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("fetch_roles controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
