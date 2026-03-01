import type { Request, Response } from "express";
import * as CommonService from "../services/common.service.js";
import { supabase } from "../config/supabase.js";
import path from "path";


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

export async function search_faculty(req: Request, res: Response){
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
    let body = req.body;
    console.log("[DEBUG] create_request body keys:", Object.keys(body));
    console.log("[DEBUG] req.file:", req.file ? `Found: ${req.file.originalname} (${req.file.size} bytes)` : "No file found");

    // Handle multipart/form-data: Parse formData string if it exists
    if (typeof body.formData === "string") {
      try {
        body.formData = JSON.parse(body.formData);
        console.log("[DEBUG] Parsed formData string successfully");
      } catch (e) {
        console.warn("[DEBUG] Failed to parse formData JSON string", e);
      }
    }

    // Handle File Upload to Supabase if present
    if (req.file) {
      const file = req.file;
      const fileExt = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`;
      const filePath = `request-attachments/${fileName}`;

      console.log(`[DEBUG] Attempting Supabase upload to assets_sams: ${filePath}`);

      const { data, error } = await supabase.storage
        .from("assets_sams")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("[DEBUG] Supabase upload error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to upload attachment to storage",
        });
      }

      console.log("[DEBUG] Supabase upload success:", data.path);

      // Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from("assets_sams")
        .getPublicUrl(filePath);

      console.log("[DEBUG] Public URL generated:", publicUrl);

      if (!body.formData) body.formData = {};
      body.formData.attachmentUrl = publicUrl;
      body.formData.attachmentPath = filePath;
      body.formData.attachmentName = file.originalname;
      body.formData.attachmentType = file.mimetype;
    }

    const result = await CommonService.create_request({
      user: req.user,
      body: body,
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

export async function delete_fcm_token(req: Request, res: Response) {
  try {
    const result = await CommonService.deleteFCMToken({
      user: req.user,
      body: req.body,
    });

    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("delete_fcm_token controller error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}