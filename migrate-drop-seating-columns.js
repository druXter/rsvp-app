// migrate-drop-seating-columns.js
// Einmaliger Aufräumschritt, läuft beim Start des Containers VOR `prisma db push` (siehe Dockerfile):
// Entfernt die veralteten Spalten Event.seatingUrl und Event.seatingPlacementsAt. Ihr Inhalt steht
// seit migrate-tool-links.js (PRAGMA user_version 2) in der Tabelle EventToolLink.
//
// Warum vor db push: Fehlen die Spalten im Schema, stehen aber noch mit Daten in der Datenbank,
// verweigert `prisma db push` den Abgleich (Datenverlust) - und `--accept-data-loss` wollen wir nie
// dauerhaft im Startbefehl haben. Deshalb entfernt dieses Skript genau diese zwei Spalten selbst.
//
// - Gibt es die Spalten nicht (frische Datenbank, schon erledigt), passiert nichts.
// - Gibt es sie, aber user_version ist kleiner als 2, wurden die Links noch nie übernommen: Abbruch
//   mit Hinweis, erst die Vorgängerversion einmal zu starten (siehe README). Sonst gingen sie verloren.
const { PrismaClient } = require('@prisma/client');

const LEGACY_COLUMNS = ['seatingUrl', 'seatingPlacementsAt'];
const REQUIRED_VERSION = 2; // migrate-tool-links.js

async function main(prisma) {
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("Event")');
  const present = LEGACY_COLUMNS.filter((name) => columns.some((c) => c.name === name));
  if (present.length === 0) {
    console.log('[migrate-drop-seating-columns] nichts zu tun');
    return;
  }

  const [{ user_version: raw }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  const current = Number(raw);
  if (current < REQUIRED_VERSION) {
    throw new Error(
      `Datenbank-Version ${current}: Die Seating-Links in Event.seatingUrl wurden noch nicht nach EventToolLink ` +
        `übernommen. Erst die Vorgängerversion (Commit ca1bd37) einmal starten, dann dieses Update einspielen.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const name of present) await tx.$executeRawUnsafe(`ALTER TABLE "Event" DROP COLUMN "${name}"`);
  });
  console.log(`[migrate-drop-seating-columns] entfernt: ${present.map((n) => `Event.${n}`).join(', ')}`);
}

module.exports = { main };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-drop-seating-columns] FEHLER:', e);
      process.exit(1); // Container startet nicht, statt db push in einen Datenverlust laufen zu lassen
    })
    .finally(() => prisma.$disconnect());
}
