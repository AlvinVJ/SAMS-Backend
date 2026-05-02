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
      procedureId: id as string,
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
      procedureId: id as string,
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
      procedureId: id as string,
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
  const { batch_id, dept_id } = req.query;
  const result = await AdminService.getClasses(
    batch_id ? Number(batch_id) : undefined,
    dept_id ? Number(dept_id) : undefined
  );
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


export async function searchFaculty(req: Request, res: Response) {
  const { query, dept_id } = req.body;
  const result = await AdminService.searchFacultyService(query as string, dept_id ? Number(dept_id) : undefined);
  return res.status(result.statusCode).json({
    success: result.success,
    message: result.message,
    data: result.data ?? null,
  });
}

export async function updateUser(req: Request, res: Response) {
  const result = await AdminService.updateUserService({
    mits_uid: req.params.id,
    ...req.body,
  });
  return res.status(result.statusCode).json(result);
}

export async function createUser(req: Request, res: Response) {
  const result = await AdminService.createUserService(req.body);
  return res.status(result.statusCode).json(result);
}

export async function createUserType(req: Request, res: Response) {
  const result = await AdminService.createUserTypeService(req.body);
  return res.status(result.statusCode).json(result);
}

export async function getRoles(req: Request, res: Response) {
  const result = await AdminService.getRolesService();
  return res.status(result.statusCode).json(result);
}

export async function createRole(req: Request, res: Response) {
  const result = await AdminService.createRoleService(req.body);
  return res.status(result.statusCode).json(result);
}

export async function updateRole(req: Request, res: Response) {
  const result = await AdminService.updateRoleService(req.body);
  return res.status(result.statusCode).json(result);
}

export async function deleteRole(req: Request, res: Response) {
  const result = await AdminService.deleteRoleService(Number(req.params.id));
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
      .pipe(parse({ headers: true, trim: true }))
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
      .pipe(parse({ headers: true, trim: true }))
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

export async function bulkImportStudents(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const users: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true, trim: true }))
      .on("data", (row) => {
        users.push(row);
      })
      .on("end", async () => {
        const result = await AdminService.bulkImportUsersService({
          users,
          defaultUserType: "STUDENT"
        });
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportStudents error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function bulkImportFaculty(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const users: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true, trim: true }))
      .on("data", (row) => {
        users.push(row);
      })
      .on("end", async () => {
        const result = await AdminService.bulkImportUsersService({
          users,
          defaultUserType: "FACULTY"
        });
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportFaculty error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function bulkImportClubs(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const clubs: any[] = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ headers: true, trim: true }))
      .on("data", (row) => {
        clubs.push(row);
      })
      .on("end", async () => {
        const result = await AdminService.bulkImportClubsService({ clubs });
        fs.unlinkSync(req.file!.path); // Clean up
        return res.status(result.statusCode).json(result);
      });
  } catch (error) {
    console.error("bulkImportClubs error:", error);
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
      .pipe(parse({ headers: true, trim: true }))
      .on("data", (row) => {
        if (row.mits_uid) {
          students.push(row);
        }
      })
      .on("end", async () => {
        const placementService = await import("../services/placement.service.js");
        const result = await placementService.processPlacementAttendance({
          procedureId: "PLACEMENT_BULK", // Fixed: Added procedureId
          hookData: students,
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

export async function removeDepartmentRole(req: Request<{ mits_uid: string }>, res: Response) {
  const { mits_uid } = req.params;
  if (!mits_uid) {
    return res.status(400).json({ success: false, message: "mits_uid is required" });
  }
  const result = await AdminService.removeDepartmentRole({ mits_uid });
  return res.status(result.statusCode).json(result);
}

export async function getClassFacultyRoles(req: Request, res: Response) {
  const result = await AdminService.getClassFacultyRoles(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

export async function assignClassRole(req: Request, res: Response) {
  const result = await AdminService.assignClassRole(req.body);
  return res.status(result.statusCode).json(result);
}

export async function removeClassRole(req: Request<{ class_id: string, mits_uid: string, role_tag: string }>, res: Response) {
  const { class_id, mits_uid, role_tag } = req.params;
  if (!class_id || !mits_uid || !role_tag) {
    return res.status(400).json({ success: false, message: "class_id, mits_uid, and role_tag are required" });
  }
  const result = await AdminService.removeClassRole({
    class_id: Number(class_id),
    mits_uid,
    role_tag
  });
  return res.status(result.statusCode).json(result);
}

// ============================================
// GLOBAL ROLE ASSIGNMENTS
// ============================================

export async function getRoleUsers(req: Request, res: Response) {
  const result = await AdminService.getRoleUsersService(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

export async function assignRoleUser(req: Request, res: Response) {
  const { role_id, mits_uid } = req.body;
  if (!role_id || !mits_uid) {
    return res.status(400).json({ success: false, message: "role_id and mits_uid are required" });
  }
  const result = await AdminService.assignRoleUserService(Number(role_id), mits_uid);
  return res.status(result.statusCode).json(result);
}

export async function removeRoleUser(req: Request<{ id: string, mits_uid: string }>, res: Response) {
  const { id, mits_uid } = req.params;
  if (!id || !mits_uid) {
    return res.status(400).json({ success: false, message: "role_id and mits_uid are required" });
  }
  const result = await AdminService.removeRoleUserService(Number(id), mits_uid);
  return res.status(result.statusCode).json(result);
}

export async function getClassStudents(req: Request, res: Response) {
  const result = await AdminService.getClassStudentsService(Number(req.params.id));
  return res.status(result.statusCode).json(result);
}

export async function getClubs(req: Request, res: Response) {
  const result = await AdminService.getClubsService();
  return res.status(result.statusCode).json(result);
}

export async function assignClubRole(req: Request, res: Response) {
  const result = await AdminService.assignClubRoleService(req.body);
  return res.status(result.statusCode).json(result);
}

export async function removeClubRole(req: Request, res: Response) {
  const { club_id, mits_uid, role_tag } = req.params;
  const result = await AdminService.removeClubRoleService({
    club_id: Number(club_id),
    mits_uid,
    role_tag
  });
  return res.status(result.statusCode).json(result);
}
