// migrate-tool-links.js
// Einmalige Datenmigration (läuft beim Start des Containers nach migrate-token-hashes.js, siehe
// Dockerfile): Verknüpfungen mit anderen Tools der Suite stehen jetzt in der Tabelle
// EventToolLink (eine Zeile je Termin und Tool-Typ, siehe app/lib/linked-tools.ts) statt in
// Spalten am Event. Bisher gab es nur Seating mit Event.seatingUrl und Event.seatingPlacementsAt.
//
// - Jede gesetzte seatingUrl wird als EventToolLink { type: "seating", url, remoteEventId }
//   übernommen, seatingPlacementsAt als syncedAt - UNVERÄNDERT und ohne Blick auf die aktuelle
//   Konfiguration (SEATING_BASE_URL/SEATING_SECRET): Ob ein Link gilt, prüft die App bei jeder
//   Verwendung, genau wie vorher. So geht auch ein Link nicht verloren, dessen Anbindung gerade
//   nicht eingerichtet ist.
// - Die alten Spalten bleiben unangetastet stehen (Rollback auf die vorherige Version hat die
//   Links dann noch), werden aber von der App nicht mehr gelesen oder geschrieben.
//
// Läuft genau EINMAL: Der Stand steht in PRAGMA user_version (SQLite, 1 = Token-Hashes, 2 = diese
// Migration). Ein zweiter Lauf würde eine inzwischen in der Oberfläche entfernte Verknüpfung aus
// der alten Spalte wiederherstellen - deshalb die Sperre. Ohne vorherige Token-Migration bricht
// sie ab: Sonst stünde user_version auf 2 und migrate-token-hashes.js würde danach übersprungen.
const { PrismaClient } = require('@prisma/client');

const TARGET_VERSION = 2;
const REQUIRED_VERSION = 1; // migrate-token-hashes.js

/** Event-ID bei Seating aus einem gespeicherten Link (`<Origin>/rsvp/<id>`) - '' wenn unlesbar. */
function remoteEventIdOf(url) {
  try {
    return new URL(url.trim()).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
}

/** Kopiert alle alten Seating-Links, für die es noch keine Zeile gibt. Gibt die Zahl der neuen Zeilen zurück. */
async function copyLegacySeatingLinks(prisma) {
  const events = await prisma.event.findMany({
    where: { seatingUrl: { not: null } },
    select: { id: true, seatingUrl: true, seatingPlacementsAt: true },
  });
  let created = 0;
  for (const event of events) {
    if (!event.seatingUrl.trim()) continue;
    const where = { eventId_type: { eventId: event.id, type: 'seating' } };
    if (await prisma.eventToolLink.findUnique({ where })) continue;
    await prisma.eventToolLink.create({
      data: {
        eventId: event.id,
        type: 'seating',
        url: event.seatingUrl,
        remoteEventId: remoteEventIdOf(event.seatingUrl),
        syncedAt: event.seatingPlacementsAt,
      },
    });
    created++;
  }
  return created;
}

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

  const created = await prisma.$transaction(async (tx) => {
    const count = await copyLegacySeatingLinks(tx);
    await tx.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
    return count;
  });
  console.log(`[migrate-tool-links] Seating-Verknüpfungen übernommen: ${created}`);
}

module.exports = { copyLegacySeatingLinks, main };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-tool-links] FEHLER:', e);
      process.exit(1); // Container startet nicht mit halb migrierten Daten
    })
    .finally(() => prisma.$disconnect());
}
