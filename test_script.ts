import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany({
    take: 5,
  });
  console.log('Sample students:', students);

  const classes = await prisma.classes.findMany({
    take: 5,
    include: { _count: { select: { Student: true } } }
  });
  console.log('Sample classes with student counts:', classes);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
