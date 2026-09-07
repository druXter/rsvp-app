// set-role.js
// Setzt die Rolle (ADMIN/CREATOR/MODERATOR) eines bestehenden Kontos. Gedacht für die
// einmalige Beförderung des allerersten Kontos zu ADMIN nach dem Rollen-System-Update -
// danach kann ein Admin weitere Rollen bequem über "+ Nutzer anlegen" im Dashboard vergeben.
//
// Lokal:  node set-role.js deine-email@domain.de ADMIN
// Docker: docker compose run --rm rsvp-app node set-role.js deine-email@domain.de ADMIN
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VALID_ROLES = ['ADMIN', 'CREATOR', 'MODERATOR'];

async function main() {
  const [, , email, role] = process.argv;
  if (!email || !VALID_ROLES.includes(role)) {
    console.error(`Verwendung: node set-role.js <email> <${VALID_ROLES.join('|')}>`);
    process.exit(1);
  }

  const user = await prisma.user.update({ where: { email }, data: { role } });
  console.log(`Rolle von ${user.email} ist jetzt: ${user.role}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
