// app/lib/wichteln-store.ts
import { prisma } from './prisma'
import { TOOL_LINKS } from './linked-tools-store'
import { MAX_GUESTS, wichtelnGuestOf, wichtelnLinkOf, type WichtelnGuest, type WichtelnRequest } from './wichteln'

/**
 * Datenbankseite der Gästeliste für Wichteln (app/api/wichteln/guests). Ein Termin wird nur herausgegeben, wenn SEINE
 * Verknüpfung mit Wichteln (EventToolLink, Typ "wichteln") auf genau die anfragende wichtelnEventId zeigt - eine gültig
 * signierte Nachricht mit einer fremden rsvpEventId reicht nicht (beide Seiten müssen verknüpft sein).
 */
export async function linkedWichtelnEvent(message: WichtelnRequest) {
  const event = await prisma.event.findUnique({ where: { id: message.rsvpEventId }, include: { series: true, toolLinks: TOOL_LINKS } })
  if (!event) return null
  const link = wichtelnLinkOf(event)
  if (!link || link.remoteEventId !== message.wichtelnEventId) return null
  return { event, link }
}

/** Alle Zusagen des Termins, die für Wichteln zählen, mit E-Mail; jede Adresse einmal (die älteste Zusage). */
export async function wichtelnGuests(event: { id: string; requireVerification: boolean; series: { requireVerification: boolean } | null }): Promise<WichtelnGuest[]> {
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId: event.id, isAttending: true, isOnWaitlist: false },
    select: { id: true, isAttending: true, isOnWaitlist: true, participant: { select: { name: true, email: true, isVerified: true } } },
    orderBy: { createdAt: 'asc' },
    take: MAX_GUESTS
  })
  const seen = new Set<string>()
  const guests: WichtelnGuest[] = []
  for (const rsvp of rsvps) {
    const guest = wichtelnGuestOf(rsvp, rsvp.participant, requireVerification)
    if (!guest || seen.has(guest.email)) continue
    seen.add(guest.email)
    guests.push(guest)
  }
  return guests
}
