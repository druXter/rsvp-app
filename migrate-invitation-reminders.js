// migrate-invitation-reminders.js
// Einmalige Datenmigration (läuft beim Start des Containers nach `prisma db push`, siehe Dockerfile):
// Erinnerungen an Einladungen ohne Antwort merken sich jetzt pro Termin, dass sie verschickt sind
// (InvitationReminder, app/lib/invitation-reminder.ts) - nötig für Einladungen einer Reihe mit mehreren Fristen.
// Bisher stand das an der Einladung (Invitation.reminderSentAt, nur Einzel-Events). Diese Migration überträgt
// gesetzte Werte, damit niemand eine zweite Erinnerung für dieselbe Frist bekommt, und leert das alte Feld.
//
// Der Stand steht in PRAGMA user_version (5 = diese Migration), Voraussetzung ist migrate-person-details.js (4).
const { PrismaClient } = require('@prisma/client');

const TARGET_VERSION = 5;
const REQUIRED_VERSION = 4; // migrate-person-details.js

async function main(prisma) {
  const [{ user_version: raw }] = await prisma.$queryRawUnsafe('PRAGMA user_version');
  const current = Number(raw);
  if (current >= TARGET_VERSION) {
    console.log(`[migrate-invitation-reminders] bereits erledigt (Version ${current})`);
    return;
  }
  if (current < REQUIRED_VERSION) {
    throw new Error(`Datenbank-Version ${current} - erst migrate-person-details.js ausführen (Version ${REQUIRED_VERSION}).`);
  }

  await prisma.$transaction(async (tx) => {
    const reminded = await tx.invitation.findMany({
      where: { reminderSentAt: { not: null }, eventId: { not: null } },
      select: { id: true, eventId: true, reminderSentAt: true },
    });
    for (const invitation of reminded) {
      await tx.invitationReminder.upsert({
        where: { invitationId_eventId: { invitationId: invitation.id, eventId: invitation.eventId } },
        create: { invitationId: invitation.id, eventId: invitation.eventId, sentAt: invitation.reminderSentAt },
        update: {},
      });
    }
    await tx.invitation.updateMany({ where: { reminderSentAt: { not: null } }, data: { reminderSentAt: null } });
    await tx.$executeRawUnsafe(`PRAGMA user_version = ${TARGET_VERSION}`);
    console.log(`[migrate-invitation-reminders] ${reminded.length} Erinnerung(en) übernommen`);
  });
}

module.exports = { main };

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('[migrate-invitation-reminders] FEHLER:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
