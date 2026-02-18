// // src/db/prisma.ts
// import "dotenv/config";
// import { PrismaMssql } from "@prisma/adapter-mssql";
// import { PrismaClient } from "../../generated/prisma/client.js";

// const globalForPrisma = globalThis as unknown as {
//   prisma?: PrismaClient;
// };

// const sqlConfig = {
//   user: process.env.DB_USER!,
//   password: process.env.DB_PASSWORD!,
//   database: process.env.DB_NAME!,
//   server: process.env.HOST!,
//   pool: {
//     max: 10,
//     min: 0,
//     idleTimeoutMillis: 30000,
//   },
//   options: {
//     encrypt: true, // required for Azure SQL
//     trustServerCertificate: false,
//   },
// };

// export const prisma =
//   globalForPrisma.prisma ??
//   new PrismaClient({
//     adapter: new PrismaMssql(sqlConfig),
//   });

// if (process.env.NODE_ENV !== "production") {
//   globalForPrisma.prisma = prisma;
// }




// src/db/prisma.ts
// src/db/prisma.ts
import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({adapter});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

