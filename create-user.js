// create-user.js
// Legt ein Benutzerkonto an (oder setzt bei einem bestehenden das Passwort und die Rolle neu).
// Für das allererste Konto auf einem frischen Server, da es keine öffentliche Registrierung gibt -
// danach kannst du im Dashboard über "+ Nutzer anlegen" weitere Konten erstellen. Auch der
// einzige Weg, ein Admin-Konto zurückzusetzen (der Reset per Mail ist für Admins ausgeschlossen).
//
// Das Passwort wird verdeckt abgefragt (mind. 10 Zeichen), damit es weder im Shell-Verlauf noch in
// der Prozessliste landet. Nicht-interaktiv geht auch: PASSWORD=... node create-user.js ...
//
// Lokal:  node create-user.js deine-email@domain.de [ADMIN|CREATOR|MODERATOR]
// Docker: docker compose run --rm rsvp-app node create-user.js deine-email@domain.de ADMIN
const readline = require('node:readline');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const ROLES = ['ADMIN', 'CREATOR', 'MODERATOR'];
const MIN_PASSWORD_LENGTH = 10;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      // Die Frage selbst anzeigen, getippte Zeichen aber nicht.
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const [, , emailArg, roleArg] = process.argv;
  const role = roleArg || 'CREATOR';
  if (!emailArg || !ROLES.includes(role)) {
    console.error(`Verwendung: node create-user.js <email> [${ROLES.join('|')}]`);
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  const password = process.env.PASSWORD || (await askHidden('Passwort: '));
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
    process.exit(1);
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    console.error('Das Passwort ist zu lang (höchstens 72 Byte, bcrypt-Grenze).');
    process.exit(1);
  }
  if (!process.env.PASSWORD && (await askHidden('Passwort wiederholen: ')) !== password) {
    console.error('Die Passwörter stimmen nicht überein.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    // Ein offener Reset-Link wird mit einem neu gesetzten Passwort überflüssig.
    update: { passwordHash, role, resetToken: null, resetTokenExpiresAt: null },
    create: { email, passwordHash, role },
  });
  // Ein neues Passwort beendet alle bestehenden Sitzungen dieses Kontos.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  console.log(`Konto bereit: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
