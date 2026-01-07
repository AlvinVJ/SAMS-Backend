import type { Request, Response, NextFunction } from "express";

type Role = "ADMIN" | "FACULTY" | "STUDENT";

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log(req);
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden",
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
}
