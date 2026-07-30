// seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.upsert({
    where: { slug: 'sommerfest' },
    update: {},
    create: {
      slug: 'sommerfest',
      title: 'Sommerfest in der Studikneipe',
      date: new Date('2026-08-15T18:00:00Z'),
      location: 'Studikneipe Koblenz',
      description: 'Unser großes Sommerfest steht an! Bitte gebt uns Bescheid, ob ihr dabei seid, damit wir Essen und Getränke planen können.',
    },
  });
  console.log('Test-Event angelegt:', event.title);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });