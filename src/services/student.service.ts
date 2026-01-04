import { prisma } from "../db/prisma.js";

export async function getStudent(id: string) {
  return prisma.student.findUnique({
    where: { id },
  });
}
