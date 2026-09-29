// app/api/seating/guest-list/route.ts
import { NextResponse } from 'next/server'
import { createMessage, ownOrigin, readLimitedText, seatingSecret, verifyMessage } from '../../../lib/seating'
import { confirmedGuests, linkedEvent } from '../../../lib/seating-sync'

export const dynamic = 'force-dynamic'

const MAX_BODY = 20_000

/**
 * Gästeliste für Seating (typ "guest-list-request" -> Antwort "guest-list", siehe
 * app/lib/seating.ts). Seating fragt signiert an, wir antworten signiert mit allen Zusagen des
 * Termins, die dort zählen. Ungültige Signatur, falsche Art, falscher Empfänger oder abgelaufen:
 * 401. Gültig, aber das Event gibt es nicht oder seine Seating-Verknüpfung zeigt nicht auf genau diese
 * seatingEventId: 404 - Daten eines nicht so verknüpften Events gehen nie heraus.
 */
export async function POST(request: Request) {
  const secret = seatingSecret()
  const audience = ownOrigin()
  if (!secret || !audience) return NextResponse.json({ error: 'not configured' }, { status: 404 })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyMessage(body, 'guest-list-request', { secret, audience })
  if (!message) return NextResponse.json({ error: 'invalid message' }, { status: 401 })

  const linked = await linkedEvent(message)
  if (!linked) return NextResponse.json({ error: 'not linked' }, { status: 404 })

  const reply = createMessage('guest-list', {
    aud: linked.link.origin,
    seatingEventId: linked.link.seatingEventId,
    rsvpEventId: linked.event.id,
    guests: await confirmedGuests(linked.event)
  }, secret, { ttlSeconds: 300 })

  return new Response(reply, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
