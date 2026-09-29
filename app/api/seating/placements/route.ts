// app/api/seating/placements/route.ts
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ownOrigin, readLimitedText, seatingSecret, verifyMessage } from '../../../lib/seating'
import { applyPlacements, linkedEvent } from '../../../lib/seating-sync'

export const dynamic = 'force-dynamic'

// Seating schickt bis zu 5000 Einträge mit je bis zu 500 Zeichen Label - realistisch sind es
// wenige KB ("Tisch 7, Plätze 3, 4"); 2 MB decken auch den ungünstigsten sinnvollen Fall ab.
const MAX_BODY = 2_000_000

/**
 * Rückmeldung der Platzierungen aus Seating (typ "placements", siehe app/lib/seating.ts): der
 * VOLLSTÄNDIGE Stand für diesen Termin - die genannten Zusagen bekommen ihr Rsvp.seatingLabel,
 * alle übrigen werden geleert (applyPlacements). Prüfung wie bei guest-list: 401 bei ungültiger
 * Nachricht, 404, wenn das Event nicht genau so verknüpft ist.
 */
export async function POST(request: Request) {
  const secret = seatingSecret()
  const audience = ownOrigin()
  if (!secret || !audience) return NextResponse.json({ error: 'not configured' }, { status: 404 })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyMessage(body, 'placements', { secret, audience })
  if (!message) return NextResponse.json({ error: 'invalid message' }, { status: 401 })

  const linked = await linkedEvent(message)
  if (!linked) return NextResponse.json({ error: 'not linked' }, { status: 404 })

  const outcome = await applyPlacements(linked.event, linked.link, message.placements, message.iat)
  if (outcome === 'applied') {
    revalidatePath(`/${linked.event.slug}`)
    if (linked.event.series) revalidatePath(`/reihe/${linked.event.series.slug}/${linked.event.slug}`)
    revalidatePath('/admin')
  }
  return NextResponse.json({ ok: true, outcome }, { headers: { 'Cache-Control': 'no-store' } })
}
