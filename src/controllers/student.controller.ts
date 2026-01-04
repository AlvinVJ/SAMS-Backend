import type { Request, Response } from "express";
import * as StudentService from "../services/student.service.js";

export async function getStudentById(
  req: Request,
  res: Response
) {
  const { id } = req.params;

  const student = await StudentService.getStudent(id);

  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }

  return res.json(student);
}
