// src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";

export function requireRole(role: "ADMIN" | "FACULTY" | "STUDENT") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
