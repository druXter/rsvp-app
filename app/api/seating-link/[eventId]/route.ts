// app/api/seating-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { createMessage, guestOf, isSeatingConfirmed } from '../../../lib/seating'
import { resolveToolLinkAccess } from '../../../lib/linked-tools-access'

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
 * (typ "seat-link", siehe app/lib/seating.ts) zu Seating weiter - `<Sitzplatz-Link>?t=<Nachricht>`.
 * Gleiches Muster wie /api/poll-link/[eventId]: Die Seite verlinkt mit einem normalen <a> hierher
 * (kein <Link> - ein Client-Router-Übergang in einen Route Handler, der seinerseits auf eine fremde
 * Domain weiterleitet, hängt), und der Link wird bei JEDEM Klick neu ausgestellt.
 *
 * Wer weitergeleitet wird (editToken genau dieses Termins oder verifizierte Gast-Session, PIN,
 * Zusage zählt bei Seating), prüft resolveToolLinkAccess (app/lib/linked-tools-access.ts) -
 * alles andere landet wieder auf der Event-Seite, nie bei Seating.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const access = await resolveToolLinkAccess(request, eventId, 'seating', isSeatingConfirmed)
  if (!access.ok) return redirectTo(access.redirect)

  const { event, tool, link, rsvp, participant } = access
  const message = createMessage('seat-link', {
    aud: link.origin,
    seatingEventId: link.remoteEventId,
    rsvpEventId: event.id,
    ...guestOf(rsvp, participant)
  }, tool.secret, { ttlSeconds: SEAT_LINK_TTL_SECONDS })

  const target = new URL(link.url)
  target.searchParams.set('t', message)
  return redirectTo(target)
}
