// migrate-person-details.js
// Einmalige Datenmigration (läuft beim Start des Containers nach `prisma db push`, siehe Dockerfile):
// Alkohol und Einlass gibt es jetzt pro Person (RsvpPerson.drinksAlcohol/checkedInAt, app/lib/checkin.ts).
//
// - Alkohol der Antwort (Rsvp.drinksAlcohol) geht an die anmeldende Person (Position 0) - bei eingeladenen
//   Haushalten, wo die Frage einmal für alle gestellt wurde, an alle zusagenden Erwachsenen.
// - Eingecheckte Antworten (Rsvp.hasAttended): alle zusagenden Personen gelten als eingecheckt.
// Antworten ohne Personenliste bleiben, wie sie sind - dort gilt weiter die Antwort selbst.
//
// Der Stand steht in PRAGMA user_version (4 = diese Migration), Voraussetzung ist migrate-persons.js (3).
const { PrismaClient } = require('@prisma/client');

const TARGET_VERSION = 4;
const REQUIRED_VERSION = 3; // migrate-persons.js

/**
 * Was eine Antwort an ihre Personen weitergibt: { alcohol: [ids], checkIn: [ids] }. Nur Personen ohne eigene
 * Angabe bekommen den Alkohol, nur zusagende den Einlass.
 */
function personUpdates(rsvp) {
  const persons = [...rsvp.persons].sort((a, b) => a.position - b.position);
  const household = persons.some((p) => p.invitationPersonId);
  const alcohol = rsvp.drinksAlcohol === null || rsvp.drinksAlcohol === undefined
    ? []
    : persons.filter((p, i) => (household ? p.isAttending : i === 0) && p.ageGroup === 'ADULT' && p.drinksAlcohol === null).map((p) => p.id);
  const checkIn = rsvp.hasAttended ? persons.filter((p) => p.isAttending && !p.checkedInAt).map((p) => p.id) : [];
  return { alcohol, checkIn };
}

async function main(prisma) {
  const [{ user_version: raw }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  const current = Number(raw);
  if (current >= TARGET_VERSION) {
    console.log(`[migrate-person-details] bereits erledigt (Version ${current})`);
    return;
  }
  if (current < REQUIRED_VERSION) {
    throw new Error(`Datenbank-Version ${current} - erst migrate-persons.js ausführen (Version ${REQUIRED_VERSION}).`);
  }

  await prisma.$transaction(async (tx) => {
    let alcohol = 0;
    let checkIn = 0;
    const rsvps = await tx.rsvp.findMany({
      where: { persons: { some: {} }, OR: [{ drinksAlcohol: { not: null } }, { hasAttended: true }] },
      select: { id: true, drinksAlcohol: true, hasAttended: true, checkedInAt: true, persons: true },
    });
    for (const rsvp of rsvps) {
      const updates = personUpdates(rsvp);
      if (updates.alcohol.length > 0) {
        await tx.rsvpPerson.updateMany({ where: { id: { in: updates.alcohol } }, data: { drinksAlcohol: rsvp.drinksAlcohol } });
        alcohol += updates.alcohol.length;
      }
      if (updates.checkIn.length > 0) {
        await tx.rsvpPerson.updateMany({ where: { id: { in: updates.checkIn } }, data: { checkedInAt: rsvp.checkedInAt || new Date() } });
        checkIn += updates.checkIn.length;
      }
    }
    await tx.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
    console.log(`[migrate-person-details] Alkohol für ${alcohol}, Einlass für ${checkIn} Person(en) übernommen`);
  });
}

module.exports = { main, personUpdates };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-person-details] FEHLER:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
