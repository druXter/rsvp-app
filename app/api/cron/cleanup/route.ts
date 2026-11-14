// app/api/cron/cleanup/route.ts
import { safeEqual } from 'suite-kit'
import { prisma } from '../../../lib/prisma'
import { NextResponse } from 'next/server'
import { deleteOrphanedParticipants } from '../../../lib/participants'
import { EXPIRED_PUSH_RETENTION_DAYS } from '../../../lib/push-subscriptions'
import { GUEST_ACCOUNT_INACTIVITY_YEARS, unverifiedGuestCutoff } from '../../../lib/guest-retention'
import { deleteGuestUsers } from '../../../lib/guest-retention-store'


const EVENT_RETENTION_MONTHS = 18

/**
 * Automatischer Cron-Endpoint für Uptime Kuma (Speicherbegrenzung, Art. 5 Abs. 1 lit. e
 * DSGVO - siehe Datenschutzerklärung Punkt 16). Läuft idempotent und unabhängig von den
 * Erinnerungs-Mails in app/api/cron/reminders/route.ts, daher ein eigener Endpoint mit
 * eigenem Uptime-Kuma-Monitor (z.B. einmal täglich statt stündlich reicht hier völlig).
 *
 * 1. Löscht Events (Einzel-Events UND Reihen-Termine), deren Datum mehr als
 *    EVENT_RETENTION_MONTHS zurückliegt, komplett inkl. aller Rsvps - bewusst auch den
 *    Event-Datensatz selbst (Titel/Datum/Ort), nicht nur die Gast-Antworten, damit z.B.
 *    im AStA-Kontext bei wiederkehrenden Jahres-Events genug Vorlaufzeit bleibt, um vor
 *    dem nächsten Durchlauf noch chronische No-Show-Gäste im Vorjahresvergleich zu sehen.
 * 2. Räumt danach verwaiste Participant-Zeilen auf (keine Rsvp mehr übrig) - das betrifft
 *    gerade dadurch verwaiste Participants (Reihen-Participants mit einer Antwort zu einem
 *    jüngeren Termin bleiben dagegen unangetastet) sowie Altlasten aus der Zeit, bevor
 *    deleteEvent/deleteRsvp/deleteUser selbst aufgeräumt haben (deleteOrphanedParticipants,
 *    app/lib/participants.ts - dieselbe Funktion, hier ohne Einschränkung auf bestimmte IDs).
 * 3. Löscht Nutzer-Konten (GuestUser), die seit GUEST_ACCOUNT_INACTIVITY_YEARS nicht mehr
 *    eingeloggt waren, vollständig inkl. aller Reihen-Zuordnungen und Antworten - bewusst
 *    NICHT für Admin-Konten (User), da die eine fortlaufende Vereins-/Referats-Identität
 *    mit eigenen Events/Reihen repräsentieren und nicht automatisiert verschwinden sollen.
 * 3b. Löscht unbestätigte Nutzer-Konten UNVERIFIED_GUEST_ACCOUNT_DAYS nach der Registrierung (app/lib/guest-retention.ts).
 * 4. Löscht Push-Abos (Gäste und Verwaltung), die der Push-Dienst vor mehr als EXPIRED_PUSH_RETENTION_DAYS als
 *    ungültig abgelehnt hat und die das Gerät seitdem nicht ersetzt hat (app/lib/push-subscriptions.ts).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')

  // Ein leeres/fehlendes CRON_SECRET (z.B. der Platzhalter aus .env.example) darf den Endpunkt NICHT
  // freischalten - sonst würde "?secret=" (ebenfalls leer) den Vergleich bestehen.
  const expected = process.env.CRON_SECRET
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const eventCutoff = new Date()
  eventCutoff.setMonth(eventCutoff.getMonth() - EVENT_RETENTION_MONTHS)

  const oldEvents = await prisma.event.findMany({
    where: { date: { lt: eventCutoff } },
    select: { id: true }
  })
  const oldEventIds = oldEvents.map(e => e.id)

  await prisma.rsvp.deleteMany({ where: { eventId: { in: oldEventIds } } })
  await prisma.resourceAccess.deleteMany({ where: { eventId: { in: oldEventIds } } })
  await prisma.event.deleteMany({ where: { id: { in: oldEventIds } } })

  const deletedOrphanedParticipants = await deleteOrphanedParticipants()

  const inactivityCutoff = new Date()
  inactivityCutoff.setFullYear(inactivityCutoff.getFullYear() - GUEST_ACCOUNT_INACTIVITY_YEARS)

  const inactiveGuestUsers = await prisma.guestUser.findMany({
    where: { lastLoginAt: { lt: inactivityCutoff } },
    select: { id: true }
  })
  const inactiveGuestUserIds = inactiveGuestUsers.map(g => g.id)

  await deleteGuestUsers(inactiveGuestUserIds)

  // Unbestätigte Konten nach UNVERIFIED_GUEST_ACCOUNT_DAYS - nur ohne Antworten (ohne Login gibt es keine; eine
  // Antwort, die doch daranhängt, wird nicht stillschweigend mitgelöscht, sie fällt unter die Fristen oben).
  const unverifiedGuestUserIds = (await prisma.guestUser.findMany({
    where: { isVerified: false, createdAt: { lt: unverifiedGuestCutoff() }, participants: { none: {} } },
    select: { id: true }
  })).map(g => g.id)
  const deletedUnverifiedGuestUsers = await deleteGuestUsers(unverifiedGuestUserIds)

  const expiredPushCutoff = new Date(Date.now() - EXPIRED_PUSH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deletedGuestPush = await prisma.participantPushSubscription.deleteMany({ where: { expiredAt: { lt: expiredPushCutoff } } })
  const deletedUserPush = await prisma.pushSubscription.deleteMany({ where: { expiredAt: { lt: expiredPushCutoff } } })
  const deletedAccountPush = await prisma.guestUserPushSubscription.deleteMany({ where: { expiredAt: { lt: expiredPushCutoff } } })

  return NextResponse.json({
    success: true,
    deletedEvents: oldEventIds.length,
    deletedOrphanedParticipants,
    deletedInactiveGuestUsers: inactiveGuestUserIds.length,
    deletedUnverifiedGuestUsers,
    deletedExpiredPushSubscriptions: deletedGuestPush.count + deletedUserPush.count + deletedAccountPush.count
  })
}
