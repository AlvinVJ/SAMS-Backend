import type { Request, Response } from "express";
import * as AdminService from "../services/admin.service.js";
import { parse } from "fast-csv";
import * as fs from "fs";

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

// ============================================
// DEPARTMENTS
// ============================================

export async function getDepartments(req: Request, res: Response) {
  const result = await AdminService.getDepartments();
  return res.status(result.statusCode).json(result);
}

export async function createDepartment(req: Request, res: Response) {
  const result = await AdminService.createDepartment(req.body);
  return res.status(result.statusCode).json(result);
}

export async function updateDepartment(req: Request, res: Response) {
  const result = await AdminService.updateDepartment(req.body);
  return res.status(result.statusCode).json(result);
}

export async function deleteDepartment(req: Request, res: Response) {
  const result = await AdminService.deleteDepartment(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

// ============================================
// BATCHES
// ============================================

export async function getBatches(req: Request, res: Response) {
  const result = await AdminService.getBatches();
  return res.status(result.statusCode).json(result);
}

export async function createBatch(req: Request, res: Response) {
  const result = await AdminService.createBatch(req.body);
  return res.status(result.statusCode).json(result);
}

export async function updateBatch(req: Request, res: Response) {
  const result = await AdminService.updateBatch(req.body);
  return res.status(result.statusCode).json(result);
}

export async function deleteBatch(req: Request, res: Response) {
  const result = await AdminService.deleteBatch(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

// ============================================
// CLASSES
// ============================================

export async function getClasses(req: Request, res: Response) {
  const result = await AdminService.getClasses();
  return res.status(result.statusCode).json(result);
}

export async function createClass(req: Request, res: Response) {
  const result = await AdminService.createClass(req.body);
  return res.status(result.statusCode).json(result);
}

export async function updateClass(req: Request, res: Response) {
  const result = await AdminService.updateClass(req.body);
  return res.status(result.statusCode).json(result);
}

export async function deleteClass(req: Request, res: Response) {
  const result = await AdminService.deleteClass(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

export async function getUsers(req: Request, res: Response) {
  const { q } = req.query;
  const result = await AdminService.getUsersService(q as string);
  return res.status(result.statusCode).json(result);
}

export async function updateUser(req: Request, res: Response) {
  const result = await AdminService.updateUserService({
    mits_uid: req.params.id,
    ...req.body,
  });
  return res.status(result.statusCode).json(result);
}

export async function getRoles(req: Request, res: Response) {
  const result = await AdminService.getRolesService();
  return res.status(result.statusCode).json(result);
}

export async function getUserTypes(req: Request, res: Response) {
  const result = await AdminService.getUserTypesService();
  return res.status(result.statusCode).json(result);
}

export async function getGlobalRequests(req: Request, res: Response) {
  const result = await AdminService.getGlobalRequestsService();
  return res.status(result.statusCode).json(result);
}

export async function getAdminDashboardStats(req: Request, res: Response) {
  const result = await AdminService.getAdminDashboardStatsService();
  return res.status(result.statusCode).json(result);
}

export async function bulkImportAcademic(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const departments: any[] = [];
    const batches: any[] = [];
    const classes: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true }))
      .on("data", (row) => {
        if (row.type === "department") {
          departments.push(row);
        } else if (row.type === "batch") {
          batches.push(row);
        } else if (row.type === "class") {
          classes.push(row);
        }
      })
      .on("end", async () => {
        const result = await AdminService.bulkImportAcademicService({
          departments,
          batches,
          classes,
        });
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportAcademic error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function bulkImportUsers(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const users: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true }))
      .on("data", (row) => {
        users.push(row);
      })
      .on("end", async () => {
        console.log(`Parsed ${users.length} rows from CSV`);
        const result = await AdminService.bulkImportUsersService({ users });
        console.log("Bulk import result:", JSON.stringify(result, null, 2));
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportUsers error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function bulkImportPlacementAttendance(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const { eventName, date } = req.body;
    if (!eventName || !date) {
      return res.status(400).json({ success: false, message: "Event name and date are required" });
    }

    const students: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true }))
      .on("data", (row) => {
        if (row.mits_uid) {
          students.push(row);
        }
      })
      .on("end", async () => {
        const placementService = await import("../services/placement.service.js");
        const result = await placementService.processPlacementAttendance({
          procedureId: "PLACEMENT_BULK", // Fixed: Added procedureId
          students,
          coordinatorUid: req.user.mits_uid,
          eventName,
          date
        });
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportPlacementAttendance error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
export async function getDepartmentFacultyRoles(req: Request, res: Response) {
  const result = await AdminService.getDepartmentFacultyRoles(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

export async function assignDepartmentRole(req: Request, res: Response) {
  const result = await AdminService.assignDepartmentRole(req.body);
  return res.status(result.statusCode).json(result);
}

export async function removeDepartmentRole(req: Request, res: Response) {
  const result = await AdminService.removeDepartmentRole({ mits_uid: req.params.mits_uid });
  return res.status(result.statusCode).json(result);
}
