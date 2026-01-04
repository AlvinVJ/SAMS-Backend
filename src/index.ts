// src/index.ts
import express from "express";
import morgan from "morgan";
import { prisma } from "./db/prisma.js";


import { commonRouter } from "./routes/common.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { facultyRouter } from "./routes/faculty.routes.js";
import { studentRouter } from "./routes/student.routes.js";
import { helperRouter } from "./routes/helper.routes.js";

const app = express();
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/common", commonRouter);
app.use("/api/admin", adminRouter);
app.use("/api/faculty", facultyRouter);
app.use("/api/student", studentRouter);
app.use("/api/helpers", helperRouter);

app.get("/health/db", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "Azure SQL connected" });
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
