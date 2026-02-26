import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const reqs = await prisma.requests.findMany({
    orderBy: { created_at: 'desc' },
    take: 5
  });
  console.log("LATEST REQUESTS:");
  console.dir(reqs);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
