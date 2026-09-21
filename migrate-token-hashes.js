// migrate-token-hashes.js
// Einmalige Datenmigration (läuft beim Start des Containers, siehe Dockerfile): Bisher standen
// Reset-, E-Mail-Änderungs- und Bestätigungs-Tokens sowie Sitzungs-Tokens im KLARTEXT in der
// Datenbank. Jetzt steht dort nur noch ihr SHA-256-Hash (siehe app/lib/tokens.ts), der Klartext
// existiert nur noch im Mail-Link bzw. Cookie.
//
// - Reset-/E-Mail-Änderungs-/Bestätigungs-Tokens werden durch ihren Hash ersetzt. Bereits
//   verschickte Links funktionieren dadurch weiter (die App hasht den Token aus dem Link und
//   findet den gespeicherten Hash).
// - Alle Sitzungen (Admin und Nutzer) werden verworfen: Die Cookies heißen jetzt anders
//   (__Host-...), alte Sitzungen wären ohnehin nicht mehr gültig.
//
// Läuft genau EINMAL: Der Stand steht in PRAGMA user_version (SQLite). Ein zweiter Lauf würde die
// schon gehashten Werte ein zweites Mal hashen und damit alle Links entwerten - deshalb die Sperre.
// Auf einer frischen Datenbank ist alles leer, der Lauf setzt nur die Version.
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TARGET_VERSION = 1;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function hashColumn(table, column) {
  const rows = await prisma.$queryRawUnsafe(`SELECT id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`);
  for (const row of rows) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = ? WHERE id = ?`, sha256(row.value), row.id);
  }
  return rows.length;
}

async function main() {
  const [{ user_version: current }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  if (Number(current) >= TARGET_VERSION) {
    console.log(`[migrate-token-hashes] bereits erledigt (Version ${current})`);
    return;
  }

  const counts = {
    'User.resetToken': await hashColumn('User', 'resetToken'),
    'User.emailChangeToken': await hashColumn('User', 'emailChangeToken'),
    'GuestUser.resetToken': await hashColumn('GuestUser', 'resetToken'),
    'GuestUser.emailChangeToken': await hashColumn('GuestUser', 'emailChangeToken'),
    'GuestUser.verifyToken': await hashColumn('GuestUser', 'verifyToken'),
  };
  const sessions = await prisma.session.deleteMany({});
  const guestSessions = await prisma.guestSession.deleteMany({});

  await prisma.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
  console.log('[migrate-token-hashes] Tokens gehasht:', JSON.stringify(counts));
  console.log(`[migrate-token-hashes] Sitzungen verworfen: ${sessions.count} Admin, ${guestSessions.count} Nutzer`);
}

main()
  .catch((e) => {
    console.error('[migrate-token-hashes] FEHLER:', e);
    process.exit(1); // Container startet nicht mit halb migrierten Daten
  })
  .finally(() => prisma.$disconnect());
