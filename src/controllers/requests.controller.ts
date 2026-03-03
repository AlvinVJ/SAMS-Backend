import type { Request, Response } from "express";
import * as RequestsService from "../services/requests.service.js";
import { supabase } from "../config/supabase.js";
import path from "path";

export async function createRequest(req: Request, res: Response) {
  try {
    let body = req.body;

    // Handle multipart/form-data: Parse formData string if it exists
    if (typeof body.formData === "string") {
      try {
        body.formData = JSON.parse(body.formData);
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

      // Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from("assets_sams")
        .getPublicUrl(filePath);

      if (!body.formData) body.formData = {};
      body.formData.attachmentUrl = publicUrl;
      body.formData.attachmentPath = filePath;
      body.formData.attachmentName = file.originalname;
      body.formData.attachmentType = file.mimetype;
    }

    const result = await RequestsService.createRequest({
      body: body,
      user: req.user,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("createRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getMyRequests(req: Request, res: Response) {
  try {
    const result = await RequestsService.getMyRequests(req.user);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getMyRequests controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getStudentDashboardData(req: Request, res: Response) {
  try {
    const result = await RequestsService.getStudentDashboardData(req.user);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getStudentDashboardData controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
export async function getRequestDetails(req: Request, res: Response) {
  try {
    const reqId = req.params.reqId as string;
    if (!reqId) {
      return res.status(400).json({ success: false, message: "Request ID is required" });
    }
    const result = await RequestsService.getRequestDetails(reqId);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("getRequestDetails controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function withdrawRequest(req: Request<{ requestId: string }>, res: Response) {
  try {
    const { requestId } = req.params;
    const result = await RequestsService.withdrawRequest(requestId, req.user);
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("withdrawRequest controller error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}