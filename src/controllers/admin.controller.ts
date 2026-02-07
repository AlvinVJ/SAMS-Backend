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

export async function getProcedures(
  req: Request,
  res: Response
) {
  try {
    const result = await AdminService.getProcedures({
      user: req.user
    });
    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("getProcedures controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function getProcedureById(
  req: Request,
  res: Response
) {
  try {
    const id = req.params.id;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Procedure ID is required",
      });
    }

    const result = await AdminService.getProcedureById({
      procedureId: id,
      user: req.user
    });
    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("getProcedureById controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function updateProcedure(
  req: Request,
  res: Response
) {
  try {
    const id = req.params.id;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Procedure ID is required",
      });
    }

    const result = await AdminService.updateProcedure({
      procedureId: id,
      body: req.body,
      user: req.user
    });
    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("updateProcedure controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function deleteProcedure(
  req: Request,
  res: Response
) {
  try {
    const id = req.params.id;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Procedure ID is required",
      });
    }

    const result = await AdminService.deleteProcedure({
      procedureId: id,
      user: req.user
    });
    return res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data ?? null,
    });
  } catch (err) {
    console.error("deleteProcedure controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}