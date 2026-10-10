// migrate-persons.js
// Einmalige Datenmigration (läuft beim Start des Containers nach `prisma db push`, siehe Dockerfile):
// Aus "Begleitperson (+1) abfragen" werden Begleitungen mit Personenliste (docs/KONZEPT-EINLADUNGEN.md).
//
// - Termine mit formConfig.askPlusOne bekommen maxCompanions = 1, askPlusOne verschwindet aus formConfig.
// - Antworten mit plusOne bekommen ihre Personen: die anmeldende (Angaben vom Participant) und die Begleitung
//   (plusOneName, ohne Namen null). plusOne/plusOneName werden geleert - die Spalten entfallen später.
//
// Der Stand steht in PRAGMA user_version (3 = diese Migration). Ohne die vorherigen Migrationen (Version 2)
// bricht sie ab, wie migrate-tool-links.js.
const { PrismaClient } = require('@prisma/client');

const TARGET_VERSION = 3;
const REQUIRED_VERSION = 2; // migrate-tool-links.js

/** formConfig ohne askPlusOne und ob es gesetzt war. Ungültiges JSON bleibt, wie es ist. */
function convertFormConfig(formConfig) {
  if (!formConfig) return { formConfig, askPlusOne: false };
  let config;
  try {
    config = JSON.parse(formConfig);
  } catch {
    return { formConfig, askPlusOne: false };
  }
  if (!config || typeof config !== 'object' || !('askPlusOne' in config)) return { formConfig, askPlusOne: false };
  const { askPlusOne, ...rest } = config;
  return { formConfig: JSON.stringify(rest), askPlusOne: askPlusOne === true };
}

async function main(prisma) {
  const [{ user_version: raw }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  const current = Number(raw);
  if (current >= TARGET_VERSION) {
    console.log(`[migrate-persons] bereits erledigt (Version ${current})`);
    return;
  }
  if (current < REQUIRED_VERSION) {
    throw new Error(`Datenbank-Version ${current} - erst migrate-tool-links.js ausführen (Version ${REQUIRED_VERSION}).`);
  }

  await prisma.$transaction(async (tx) => {
    let events = 0;
    for (const event of await tx.event.findMany({ select: { id: true, formConfig: true, maxCompanions: true } })) {
      const converted = convertFormConfig(event.formConfig);
      if (converted.formConfig === event.formConfig) continue;
      await tx.event.update({
        where: { id: event.id },
        data: {
          formConfig: converted.formConfig,
          ...(converted.askPlusOne && event.maxCompanions === 0 ? { maxCompanions: 1 } : {}),
        },
      });
      events++;
    }

    const rsvps = await tx.rsvp.findMany({ where: { plusOne: true }, include: { participant: true, persons: { select: { id: true } } } });
    for (const rsvp of rsvps) {
      if (rsvp.persons.length === 0) {
        const p = rsvp.participant;
        await tx.rsvpPerson.createMany({
          data: [
            { rsvpId: rsvp.id, position: 0, name: p.name, ageGroup: 'ADULT', isAttending: rsvp.isAttending, dietaryOption: p.dietaryOption, allergies: p.allergies },
            { rsvpId: rsvp.id, position: 1, name: (rsvp.plusOneName || '').trim().slice(0, 100) || null, ageGroup: 'ADULT', isAttending: rsvp.isAttending },
          ],
        });
      }
      await tx.rsvp.update({ where: { id: rsvp.id }, data: { plusOne: false, plusOneName: null } });
    }

    await tx.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
    console.log(`[migrate-persons] ${events} Termin(e) umgestellt, ${rsvps.length} Begleitung(en) übernommen`);
  });
}

module.exports = { main, convertFormConfig };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-persons] FEHLER:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
