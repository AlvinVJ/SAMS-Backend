import { prisma } from "../db/prisma.js";

export async function getStudentProfile(auth_uid: string) {
  const userAccount = await prisma.userAccount.findUnique({
    where: { auth_uid },
    include: {
      Student: {
        include: {
          Classes: {
            include: {
              Departments: true,
            },
          },
        },
      },
    },
  });
  return userAccount;
}

export async function getNotifications(mits_uid: string) {
  // For now, we'll return some semi-dynamic notifications based on actual request status changes
  // In a full system, this would be a dedicated notifications table
  const latestRequests = await prisma.requests.findMany({
    where: { created_by: mits_uid },
    include: { Procedures: true },
    orderBy: { created_at: 'desc' },
    take: 5
  });

  const notifications = latestRequests.map(req => {
    let statusText = "submitted";
    if (req.status === 1) statusText = "approved";
    if (req.status === 2) statusText = "rejected";

    return {
      id: req.req_id,
      title: `Request ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`,
      description: `Your request for "${req.Procedures.title}" has been ${statusText}.`,
      time: req.created_at.toISOString(),
      isUnread: false,
      type: statusText === "approved" ? "success" : (statusText === "rejected" ? "error" : "info")
    };
  });

  return notifications;
}
