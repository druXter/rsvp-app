// seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const demoEmail = process.env.SEED_USER_EMAIL || 'demo@example.com';
  const demoPassword = process.env.SEED_USER_PASSWORD || process.env.ADMIN_PASSWORD || 'demo12345';

  let user = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!user) {
    const passwordHash = await bcrypt.hash(demoPassword, 10);
    user = await prisma.user.create({ data: { email: demoEmail, passwordHash } });
    console.log(`Demo-Nutzer angelegt: ${user.email} (Passwort: ${demoPassword})`);
  }

  const event = await prisma.event.upsert({
    where: { slug: 'sommerfest' },
    update: {},
    create: {
      ownerId: user.id,
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
