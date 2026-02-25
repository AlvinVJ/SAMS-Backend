// src/index.ts
import express from "express";
import morgan from "morgan";
import { prisma } from "./db/prisma.js";
import cors from "cors";


declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

import { commonRouter } from "./routes/common.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { facultyRouter } from "./routes/faculty.routes.js";
import { studentRouter } from "./routes/student.routes.js";
import { helperRouter } from "./routes/helper.routes.js";
// Import the new router at the top
import { requestsRouter } from "./routes/requests.routes.js"; // or just .routes if .js fails

// ... inside your app setup, near other routes like admin or user


const app = express();
app.use(express.json());
app.use(morgan("dev"));

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (curl, mobile apps, Postman)
      if (!origin) return callback(null, true);

      if (
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("https://sams-d2236.firebaseapp.com")||
        origin.startsWith("https://sams-d2236.web.app")||
        origin.startsWith("https://api.sams2026proj.app")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use("/api/requests", requestsRouter);
app.use("/api/common", commonRouter);
app.use("/api/admin", adminRouter);
app.use("/api/faculty", facultyRouter);
app.use("/api/student", studentRouter);
app.use("/api/helper", helperRouter);

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "Azure SQL connected" });
  } catch (error: any) {
    console.error("DB Health Check Failed:", error);
    res.status(500).json({
      status: "Database connection failed",
      error: error.message,
      code: error.code
    });
  }
});

app.get("/ping", async (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "pong",
    timestamp: new Date().toISOString(),
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});


