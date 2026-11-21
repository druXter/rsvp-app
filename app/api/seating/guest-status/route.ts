// app/api/seating/guest-status/route.ts
import { readLimitedText } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { createMessage, ownOrigin, seatingSecret, verifyMessage } from '../../../lib/seating'
import { guestStatus, linkedEvent } from '../../../lib/seating-sync'

export const dynamic = 'force-dynamic'

const MAX_BODY = 5_000

/**
 * Rückfrage von Seating vor dem Buchen über eine Zusage (typ "guest-status-request" -> Antwort "guest-status", siehe
 * app/lib/seating.ts; Seating-Audit S-04): Der Link zur Platzwahl ist ein Nachweis mit Verfallsdatum, kein Blick auf
 * den aktuellen Stand - hat die Person inzwischen abgesagt oder ihre Begleitung geändert und ist die Meldung darüber
 * verloren gegangen, sagt diese Antwort es Seating trotzdem. Prüfungen wie bei der Gästeliste: ungültig 401, nicht
 * genau so verknüpft 404. Die Antwort nennt nur, ob die Zusage zählt und für wie viele - keine Namen.
 */
export async function POST(request: Request) {
  const secret = seatingSecret()
  const audience = ownOrigin()
  if (!secret || !audience) return NextResponse.json({ error: 'not configured' }, { status: 404 })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyMessage(body, 'guest-status-request', { secret, audience })
  if (!message) return NextResponse.json({ error: 'invalid message' }, { status: 401 })

  const linked = await linkedEvent(message)
  if (!linked) return NextResponse.json({ error: 'not linked' }, { status: 404 })

  const reply = createMessage('guest-status', {
    aud: linked.link.origin,
    seatingEventId: linked.link.seatingEventId,
    rsvpEventId: linked.event.id,
    ...await guestStatus(linked.event, message.rsvpId)
  }, secret, { ttlSeconds: 120 })

  return new Response(reply, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
