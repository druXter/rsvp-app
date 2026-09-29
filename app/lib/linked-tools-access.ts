// app/lib/linked-tools-access.ts
import type { Participant, Rsvp } from '@prisma/client'
import { prisma } from './prisma'
import { getCurrentGuestUser } from './guest-auth'
import { hasEventPinAccess } from './pin'
import { configuredTool, toolLinkOf, type ConfiguredTool, type ToolLink, type ToolType } from './linked-tools'
import { TOOL_LINKS } from './linked-tools-store'

/**
 * Gemeinsamer Teil der Weiterleitungs-Routen zu verknüpften Tools ("Sitzplatz wählen" ->
 * /api/seating-link/[eventId], in Phase 7b "Zeitplan"): Wer darf mit einem frisch signierten
 * Link zum Tool weitergeleitet werden? Was im Link steht, legt die Route nach dem Vertrag ihres
 * Tools fest - dieser Helfer liefert nur die geprüfte Zusage.
 *
 * Die Person muss sich selbst nachweisen, nie über Client-Daten: entweder mit dem editToken
 * (?token=, persönlicher Link aus Seite oder Bestätigungsmail), der zu einer Rsvp GENAU DIESES
 * Termins gehören muss, oder ohne Token mit einer aktiven, verifizierten Gast-Session. PIN wie
 * überall (app/lib/pin.ts): Cookie oder ein Token, der nachweislich zu diesem Termin gehört.
 * Alles andere - auch eine Zusage, die (noch) nicht zählt - landet wieder auf der Event-Seite
 * (Termin ohne gültige Verknüpfung oder ohne eingerichtetes Tool: auf der Startseite).
 */
export type ToolLinkAccess =
  | { ok: false; redirect: URL }
  | {
    ok: true
    event: { id: string }
    tool: ConfiguredTool
    link: ToolLink
    rsvp: Rsvp
    participant: Participant
  }

export async function resolveToolLinkAccess(
  request: Request,
  eventId: string,
  type: ToolType,
  /** Zählt die Zusage bei diesem Tool? (Seating: isSeatingConfirmed) */
  counts: (rsvp: Rsvp, participant: Participant, requireVerification: boolean) => boolean
): Promise<ToolLinkAccess> {
  const token = new URL(request.url).searchParams.get('token') || null
  // BASE_URL statt request.url: Hinter einem Reverse Proxy zeigt request.url auf die interne Adresse des Containers.
  const base = process.env.BASE_URL || request.url

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true, toolLinks: TOOL_LINKS } })
  const tool = configuredTool(type)
  const link = event ? toolLinkOf(event, type) : null
  if (!event || !tool || !link) return { ok: false, redirect: new URL('/', base) }

  const eventPage = event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`

  let participant: Participant | null = null
  if (token) {
    participant = await prisma.participant.findUnique({ where: { editToken: token } })
    if (participant && event.seriesId && participant.seriesId !== event.seriesId) participant = null
  } else {
    const guestUser = await getCurrentGuestUser()
    if (guestUser?.isVerified) {
      participant = await prisma.participant.findFirst({
        where: event.seriesId
          ? { seriesId: event.seriesId, guestUserId: guestUser.id }
          : { guestUserId: guestUser.id, rsvps: { some: { eventId: event.id } } }
      })
    }
  }

  const rsvp = participant
    ? await prisma.rsvp.findUnique({ where: { eventId_participantId: { eventId: event.id, participantId: participant.id } } })
    : null

  // Ein Token, zu dem es hier eine Rsvp gibt, gehört nachweislich zu diesem Termin
  // (entspricht tokenBelongsToEvent) - der persönliche Link aus der Mail geht auch ohne PIN-Cookie.
  const tokenBelongsHere = !!token && !!rsvp
  if (!tokenBelongsHere && !(await hasEventPinAccess(event))) return { ok: false, redirect: new URL(eventPage, base) }

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  if (!participant || !rsvp || !counts(rsvp, participant, requireVerification)) {
    const back = new URL(eventPage, base)
    if (tokenBelongsHere && token) back.searchParams.set('token', token)
    return { ok: false, redirect: back }
  }

  return { ok: true, event, tool, link, rsvp, participant }
}
