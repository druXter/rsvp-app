// app/api/cron/cleanup/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { safeEqual } from '../../../lib/tokens'
import { deleteOrphanedParticipants } from '../../../lib/participants'

const prisma = new PrismaClient()

const EVENT_RETENTION_MONTHS = 18
const GUEST_ACCOUNT_INACTIVITY_YEARS = 2

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

  await prisma.rsvp.deleteMany({ where: { participant: { guestUserId: { in: inactiveGuestUserIds } } } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { guestUserId: { in: inactiveGuestUserIds } } } })
  await prisma.participant.deleteMany({ where: { guestUserId: { in: inactiveGuestUserIds } } })
  await prisma.guestUserSeries.deleteMany({ where: { guestUserId: { in: inactiveGuestUserIds } } })
  await prisma.guestSession.deleteMany({ where: { guestUserId: { in: inactiveGuestUserIds } } })
  await prisma.guestApiToken.deleteMany({ where: { guestUserId: { in: inactiveGuestUserIds } } })
  await prisma.guestUser.deleteMany({ where: { id: { in: inactiveGuestUserIds } } })

  return NextResponse.json({
    success: true,
    deletedEvents: oldEventIds.length,
    deletedOrphanedParticipants,
    deletedInactiveGuestUsers: inactiveGuestUserIds.length
  })
}
