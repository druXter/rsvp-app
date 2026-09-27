// app/api/seating-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentGuestUser } from '../../../lib/guest-auth'
import { hasEventPinAccess } from '../../../lib/pin'
import { createMessage, guestOf, isSeatingConfirmed, seatingLinkOf, seatingSecret } from '../../../lib/seating'

export const dynamic = 'force-dynamic'

/** Gültigkeit des Links zur Platzwahl - bei jedem Klick frisch ausgestellt. */
const SEAT_LINK_TTL_SECONDS = 15 * 60

function redirectTo(target: string | URL) {
  const response = NextResponse.redirect(target)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * "Sitzplatz wählen": leitet eine bestätigte Zusage mit einem kurz gültigen, signierten Link
 * (typ "seat-link", siehe app/lib/seating.ts) zu Seating weiter - `<seatingUrl>?t=<Nachricht>`.
 * Gleiches Muster wie /api/poll-link/[eventId]: Die Seite verlinkt mit einem normalen <a> hierher
 * (kein <Link> - ein Client-Router-Übergang in einen Route Handler, der seinerseits auf eine fremde
 * Domain weiterleitet, hängt), und der Link wird bei JEDEM Klick neu ausgestellt.
 *
 * Die Person muss sich selbst nachweisen, nie über Client-Daten: entweder mit dem editToken
 * (?token=, persönlicher Link aus Seite oder Bestätigungsmail), der zu einer Rsvp GENAU DIESES
 * Termins gehören muss, oder ohne Token mit einer aktiven, verifizierten Gast-Session. PIN wie
 * überall (app/lib/pin.ts): Cookie oder ein Token, der nachweislich zu diesem Termin gehört.
 * Alles andere - auch eine Zusage, die (noch) nicht zählt - landet wieder auf der Event-Seite.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const token = new URL(request.url).searchParams.get('token') || null
  // BASE_URL statt request.url: Hinter einem Reverse Proxy zeigt request.url auf die interne Adresse des Containers.
  const base = process.env.BASE_URL || request.url

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })
  const secret = seatingSecret()
  const link = event ? seatingLinkOf(event) : null
  if (!event || !secret || !link) return redirectTo(new URL('/', base))

  const eventPage = event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`

  let participant = null
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
  if (!tokenBelongsHere && !(await hasEventPinAccess(event))) return redirectTo(new URL(eventPage, base))

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  if (!participant || !rsvp || !isSeatingConfirmed(rsvp, participant, requireVerification)) {
    const back = new URL(eventPage, base)
    if (tokenBelongsHere && token) back.searchParams.set('token', token)
    return redirectTo(back)
  }

  const message = createMessage('seat-link', {
    aud: link.origin,
    seatingEventId: link.seatingEventId,
    rsvpEventId: event.id,
    ...guestOf(rsvp, participant)
  }, secret, { ttlSeconds: SEAT_LINK_TTL_SECONDS })

  const target = new URL(link.url)
  target.searchParams.set('t', message)
  return redirectTo(target)
}
