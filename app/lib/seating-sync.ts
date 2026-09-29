// app/lib/seating-sync.ts
import { prisma } from './prisma'
import { guestOf, isSeatingConfirmed, seatingLinkOf, type SeatingEnvelope, type SeatingGuest, type SeatingLink, type SeatingPlacement } from './seating'
import { TOOL_LINKS } from './linked-tools-store'

/**
 * Datenbankseite der beiden Endpunkte, die Seating aufruft (app/api/seating/guest-list und
 * app/api/seating/placements). Beide gehen ausschließlich über linkedEvent: Ein Event wird nur
 * herausgegeben bzw. verändert, wenn SEINE Verknüpfung mit Seating (EventToolLink, Typ
 * "seating") auf genau die anfragende seatingEventId
 * zeigt - eine gültig signierte Nachricht mit einer fremden rsvpEventId reicht nicht (beide
 * Seiten müssen die Verknüpfung eingetragen haben).
 */

export async function linkedEvent(message: SeatingEnvelope) {
  const event = await prisma.event.findUnique({ where: { id: message.rsvpEventId }, include: { series: true, toolLinks: TOOL_LINKS } })
  if (!event) return null
  const link = seatingLinkOf(event)
  if (!link || link.seatingEventId !== message.seatingEventId) return null
  return { event, link }
}

type LinkedEvent = NonNullable<Awaited<ReturnType<typeof linkedEvent>>>['event']

/** Alle Zusagen des Termins, die bei Seating zählen (zugesagt, nicht Warteliste, ggf. verifiziert). */
export async function confirmedGuests(event: LinkedEvent): Promise<SeatingGuest[]> {
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const rsvps = await prisma.rsvp.findMany({
    where: {
      eventId: event.id,
      isAttending: true,
      isOnWaitlist: false,
      ...(requireVerification ? { participant: { isVerified: true } } : {})
    },
    include: { participant: { select: { name: true, email: true, isVerified: true } } },
    orderBy: { createdAt: 'asc' },
    take: 5000
  })
  return rsvps
    .filter(r => isSeatingConfirmed(r, r.participant, requireVerification))
    .map(r => guestOf(r, r.participant))
}

/**
 * Vollständiger Stand der Platzierungen: die genannten Zusagen DIESES Termins bekommen ihr Label,
 * alle übrigen werden geleert. rsvpIds anderer Termine bleiben unberührt. Eine Meldung, die
 * älter ist als die zuletzt angewandte (iat), wird ignoriert - Seating schickt nach jeder
 * Änderung den ganzen Stand, eine verspätet eintreffende alte Meldung darf ihn nicht zurückdrehen.
 */
export async function applyPlacements(event: LinkedEvent, link: SeatingLink, placements: SeatingPlacement[], iat: number): Promise<'applied' | 'stale'> {
  const sentAt = new Date(iat * 1000)
  const where = { eventId_type: { eventId: event.id, type: 'seating' } }
  return prisma.$transaction(async tx => {
    // Stand der Verknüpfung erst hier lesen: Wurde sie inzwischen geändert oder entfernt, gilt die Meldung nicht mehr
    const current = await tx.eventToolLink.findUnique({ where, select: { url: true, syncedAt: true } })
    if (!current || current.url !== link.url) return 'stale'
    if (current.syncedAt && sentAt < current.syncedAt) return 'stale'

    const own = new Set((await tx.rsvp.findMany({ where: { eventId: event.id }, select: { id: true } })).map(r => r.id))
    const labels = new Map<string, string>()
    for (const p of placements) if (own.has(p.rsvpId) && p.label) labels.set(p.rsvpId, p.label.slice(0, 500))

    await tx.rsvp.updateMany({
      where: { eventId: event.id, id: { notIn: [...labels.keys()] }, seatingLabel: { not: null } },
      data: { seatingLabel: null }
    })
    // Nach Label gruppiert: bei einer Sitzordnung teilen sich oft viele Zusagen denselben Tisch.
    const byLabel = new Map<string, string[]>()
    for (const [rsvpId, label] of labels) byLabel.set(label, [...(byLabel.get(label) ?? []), rsvpId])
    for (const [label, ids] of byLabel) {
      await tx.rsvp.updateMany({ where: { eventId: event.id, id: { in: ids } }, data: { seatingLabel: label } })
    }
    await tx.eventToolLink.update({ where, data: { syncedAt: sentAt } })
    return 'applied'
  })
}
