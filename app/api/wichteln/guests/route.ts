// app/api/wichteln/guests/route.ts
import { readLimitedText } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { ownOrigin } from '../../../lib/linked-tools'
import { createGuestsReply, verifyGuestsRequest, wichtelnTool } from '../../../lib/wichteln'
import { linkedWichtelnEvent, wichtelnGuests } from '../../../lib/wichteln-store'

export const dynamic = 'force-dynamic'

const MAX_BODY = 5_000
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Gästeliste für Wichteln (wichtel-guests-request -> wichtel-guests, app/lib/wichteln.ts): Name und E-Mail aller
 * Zusagen, die zählen. 404 ohne Anbindung, 413 zu groß, 401 bei ungültiger Nachricht, 404, wenn der Termin nicht genau
 * so verknüpft ist - Daten eines nicht verknüpften Termins gehen nie heraus.
 */
export async function POST(request: Request) {
  const tool = wichtelnTool()
  const audience = ownOrigin()
  if (!tool || !audience) return NextResponse.json({ error: 'not configured' }, { status: 404, headers: NO_STORE })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413, headers: NO_STORE })

  const message = verifyGuestsRequest(body, { secret: tool.secret, audience })
  if (!message) return NextResponse.json({ error: 'invalid message' }, { status: 401, headers: NO_STORE })

  const linked = await linkedWichtelnEvent(message)
  if (!linked) return NextResponse.json({ error: 'not linked' }, { status: 404, headers: NO_STORE })

  const reply = createGuestsReply({
    aud: linked.link.origin, wichtelnEventId: linked.link.remoteEventId, rsvpEventId: linked.event.id, guests: await wichtelnGuests(linked.event)
  }, tool.secret)
  return new Response(reply, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } })
}
