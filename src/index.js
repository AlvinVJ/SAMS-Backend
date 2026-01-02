// src/index.js
import express from "express";
import { Prisma } from '@prisma/client';

const app = express();
app.use(express.json());
const prisma = new Prisma();

app.get("/ping", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "pong",
    timestamp: new Date().toISOString(),
  });
});


app.listen(3000, () => {
  console.log("Server running on port 3000");
});