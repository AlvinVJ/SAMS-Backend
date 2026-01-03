// src/scripts/test-prisma.ts
import { prisma } from "./src/db/prisma.js";

async function main() {
  const user = await prisma.user.create({
    data: {
      name: "Alvin",
      email: "alvin@test.com",
      posts: {
        create: {
          title: "Hello World",
          content: "This is my first post!",
          published: true,
        },
      },
    },
    include: { posts: true },
  });

  console.log("Created user:", user);

  const allUsers = await prisma.user.findMany({
    include: { posts: true },
  });

  console.log("All users:", allUsers);
}

await main();
await prisma.$disconnect();
