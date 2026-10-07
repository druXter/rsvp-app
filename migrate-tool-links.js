// migrate-tool-links.js
// Einmalige Datenmigration (läuft beim Start des Containers nach migrate-token-hashes.js, siehe
// Dockerfile). Früher kopierte sie die Seating-Links aus den Spalten Event.seatingUrl und
// Event.seatingPlacementsAt nach EventToolLink. Diese Spalten gibt es nicht mehr:
// migrate-drop-seating-columns.js entfernt sie vor `prisma db push`, und zwar nur, wenn diese
// Migration schon gelaufen ist. Übrig bleibt deshalb nur, die Version zu setzen.
//
// Der Stand steht in PRAGMA user_version (SQLite, 1 = Token-Hashes, 2 = diese Migration). Ohne
// vorherige Token-Migration bricht sie ab: Sonst stünde user_version auf 2 und
// migrate-token-hashes.js würde danach übersprungen.
const { PrismaClient } = require('@prisma/client');

const TARGET_VERSION = 2;
const REQUIRED_VERSION = 1; // migrate-token-hashes.js

async function main(prisma) {
  const [{ user_version: raw }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  const current = Number(raw);
  if (current >= TARGET_VERSION) {
    console.log(`[migrate-tool-links] bereits erledigt (Version ${current})`);
    return;
  }
  if (current < REQUIRED_VERSION) {
    throw new Error(`Datenbank-Version ${current} - erst migrate-token-hashes.js ausführen (Version ${REQUIRED_VERSION}).`);
  }
  await prisma.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
  console.log('[migrate-tool-links] keine alten Seating-Spalten mehr, nur Version gesetzt');
}

module.exports = { main };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-tool-links] FEHLER:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
