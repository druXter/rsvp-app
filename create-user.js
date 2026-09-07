// create-user.js
// Legt ein Benutzerkonto an (oder setzt dessen Passwort neu), falls es schon existiert.
// Für das allererste Konto auf einem frischen Server, da es keine öffentliche
// Registrierung gibt - danach kannst du im Dashboard über "+ Nutzer anlegen" weitere
// Konten erstellen, ohne dieses Skript erneut zu brauchen.
//
// Lokal:  node create-user.js deine-email@domain.de dein-passwort
// Docker: docker compose run --rm rsvp-app node create-user.js deine-email@domain.de dein-passwort
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Verwendung: node create-user.js <email> <passwort>');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log('Konto bereit:', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
