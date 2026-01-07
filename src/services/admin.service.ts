import { prisma } from "../db/prisma.js";

export async function getDashboardStats() {
  const [users, requests] = await Promise.all([
    prisma.user.count(),
    prisma.batches.count(),
  ]);

  return {
    totalUsers: users,
    totalRequests: requests,
  };
}
