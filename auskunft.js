// auskunft.js
// Auskunft und Löschung zu einer E-Mail-Adresse (Art. 15 und 17 DSGVO, Idee Q8 der Suite, Regeln in
// suite-kit/docs/KONVENTIONEN.md „Datenschutz“). Läuft nur auf dem Server, es gibt keinen Endpunkt dafür.
//
//   node auskunft.js <adresse>                  alles zu dieser Adresse als JSON auf stdout
//   node auskunft.js <adresse> --loeschen       zeigt, was gelöscht würde - ändert nichts
//   node auskunft.js <adresse> --loeschen --ja  löscht
//
// Docker: docker compose exec -T rsvp-app node auskunft.js anna@example.org
// Für alle Tools auf einmal: suite-kit/scripts/auskunft.sh
//
// Gefunden wird über die Adresse (ohne Groß-/Kleinschreibung): Verwaltungskonto, Teilnehmendenkonto, Antworten
// (Participant samt Antworten zu allen Terminen, auch die über ein Teilnehmendenkonto oder eine Einladung an diese
// Adresse) und gesendete Nachrichten an Gäste. Gelöscht wird wie bei „Meine Daten löschen“ bzw. „Konto löschen“
// (app/actions.ts, app/mein-konto/actions.ts): Antworten, Push-Abos und Identität; ein Teilnehmendenkonto samt
// Sitzungen, Tokens und Freigaben. Anders als dort meldet das Skript verknüpften Tools nichts - es nennt sie in den
// Hinweisen. Verwaltungskonten löscht es nie (an ihnen hängen Events), nur einen Hinweis.
const { PrismaClient } = require('@prisma/client');

const TOOL = 'rsvp-app';
const prisma = new PrismaClient();

/** Technisches, das keine Auskunft braucht und nicht hinausgehört (Tokens, Hashes, Push-Schlüssel). */
const SECRET_KEYS = /(token|hash|secret)$|^p256dh$|^auth$|^endpoint$/i;
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, v]) => [key, clean(v)]));
  }
  return value;
}
const same = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b;
async function idsByEmail(model, email, fields = ['email']) {
  const rows = await model.findMany({ select: { id: true, ...Object.fromEntries(fields.map(f => [f, true])) } });
  return rows.filter(row => fields.some(f => same(row[f], email))).map(row => row.id);
}

async function collect(email) {
  const users = await prisma.user.findMany({
    where: { id: { in: await idsByEmail(prisma.user, email, ['email', 'pendingEmail']) } },
    include: {
      identities: true, apiTokens: true, resourceAccess: true,
      _count: { select: { events: true, series: true, sessions: true, pushSubscriptions: true } }
    }
  });
  const guestUsers = await prisma.guestUser.findMany({
    where: { id: { in: await idsByEmail(prisma.guestUser, email, ['email', 'pendingEmail']) } },
    include: {
      seriesMemberships: { include: { series: { select: { title: true } } } },
      eventInvites: { include: { event: { select: { title: true, date: true } } } },
      apiTokens: true, toolConsents: true,
      _count: { select: { sessions: true, pushSubscriptions: true } }
    }
  });
  const invitationParticipants = (await prisma.invitation.findMany({ select: { participantId: true, email: true } }))
    .filter(i => same(i.email, email)).map(i => i.participantId);
  const participantIds = [...new Set([
    ...await idsByEmail(prisma.participant, email),
    ...invitationParticipants,
    ...(await prisma.participant.findMany({ where: { guestUserId: { in: guestUsers.map(g => g.id) } }, select: { id: true } })).map(p => p.id)
  ])];
  const participants = await prisma.participant.findMany({
    where: { id: { in: participantIds } },
    include: {
      series: { select: { title: true } },
      invitation: { include: { persons: true } },
      wishReservations: { include: { wish: { select: { title: true } } } },
      _count: { select: { pushSubscriptions: true } },
      rsvps: {
        include: {
          event: { select: { id: true, title: true, date: true, toolLinks: { select: { type: true } } } },
          ticketCategory: { select: { label: true } },
          persons: { include: { menuChoices: true } },
          note: true,
          bringClaims: { include: { slot: { select: { label: true } } } },
          presenceEntries: true
        }
      }
    }
  });
  const messages = (await prisma.guestMessage.findMany({ select: { id: true, authorEmail: true, subject: true, createdAt: true } }))
    .filter(m => same(m.authorEmail, email));
  return { users, guestUsers, participants, messages };
}

const TOOL_LABEL = { seating: 'Seating', timeline: 'Zeitplan', shifts: 'Schichten', wichteln: 'Wichteln' };

function linkedHints(participants) {
  const hints = [];
  for (const p of participants) {
    for (const r of p.rsvps) {
      const tools = [...new Set(r.event.toolLinks.map(l => TOOL_LABEL[l.type] ?? l.type))];
      if (tools.length) hints.push(`Termin „${r.event.title}“ ist mit ${tools.join(', ')} verknüpft - dort liegt die Antwort ohne Adresse (z.B. Platz, Name); bitte dort prüfen bzw. löschen.`);
    }
  }
  return [...new Set(hints)];
}

async function main() {
  const [rawEmail, ...flags] = process.argv.slice(2);
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Aufruf: node auskunft.js <adresse> [--loeschen [--ja]]');
    process.exit(1);
  }
  const erase = flags.includes('--loeschen');
  const confirmed = flags.includes('--ja');
  const found = await collect(email);
  const hints = [];
  if (found.users.length) hints.push('Verwaltungskonto vorhanden: wird nicht automatisch gelöscht (daran hängen Events). Löschen über „Konten“ einer Admin-Person bzw. set-role.js; Events vorher übergeben oder löschen.');
  hints.push(...linkedHints(found.participants));

  if (!erase) {
    console.log(JSON.stringify({
      tool: TOOL, adresse: email, erstellt: new Date().toISOString(),
      daten: {
        verwaltungskonten: clean(found.users),
        teilnehmendenkonten: clean(found.guestUsers),
        antworten: clean(found.participants),
        nachrichtenAnGaeste: clean(found.messages)
      },
      hinweise: hints
    }, null, 2));
    return;
  }

  const participantIds = found.participants.map(p => p.id);
  const guestUserIds = found.guestUsers.map(g => g.id);
  const plan = {
    identitaeten: participantIds.length,
    antworten: found.participants.reduce((n, p) => n + p.rsvps.length, 0),
    teilnehmendenkonten: guestUserIds.length,
    nachrichtenAbsender: found.messages.length
  };
  if (confirmed) {
    await prisma.$transaction([
      prisma.rsvp.deleteMany({ where: { participantId: { in: participantIds } } }),
      prisma.participantPushSubscription.deleteMany({ where: { participantId: { in: participantIds } } }),
      prisma.participant.deleteMany({ where: { id: { in: participantIds } } }),
      prisma.guestUserSeries.deleteMany({ where: { guestUserId: { in: guestUserIds } } }),
      prisma.guestSession.deleteMany({ where: { guestUserId: { in: guestUserIds } } }),
      prisma.guestApiToken.deleteMany({ where: { guestUserId: { in: guestUserIds } } }),
      prisma.guestToolConsent.deleteMany({ where: { guestUserId: { in: guestUserIds } } }),
      prisma.guestUserPushSubscription.deleteMany({ where: { guestUserId: { in: guestUserIds } } }),
      prisma.guestUser.deleteMany({ where: { id: { in: guestUserIds } } }),
      prisma.guestMessage.updateMany({ where: { id: { in: found.messages.map(m => m.id) } }, data: { authorEmail: null } })
    ]);
  }
  console.log(JSON.stringify({ tool: TOOL, adresse: email, modus: confirmed ? 'geloescht' : 'probe', loeschen: plan, hinweise: hints }, null, 2));
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
