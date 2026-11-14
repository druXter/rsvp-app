// app/api/poll-result-webhook/route.ts
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../lib/prisma'
import { NextResponse } from 'next/server'
import { verifyResultWebhookPayload } from '../../lib/poll-verification'
import { abstimmungstoolOrigin, pointsToPoll } from '../../lib/poll-date'

// Größere Meldungen verschickt das Abstimmungstool nie; alles darüber wird gar nicht erst gelesen.
const MAX_BODY = 100_000


/**
 * Empfängt die Ergebnis-Meldung von abstimmungstool, sobald eine verknüpfte
 * Abstimmung schließt (Gegenstück zu dessen notifyRsvpAppOfResult in
 * app/lib/rsvp-notify.ts) - Body ist der signierte Token selbst (text/plain).
 * Speichert das Ergebnis als JSON auf Event.pollResult, gerendert auf der
 * Event-Seite (siehe app/[slug]/page.tsx / app/reihe/.../page.tsx).
 */
export async function POST(request: Request) {
  const body = await readLimitedText(request, MAX_BODY)
  const result = verifyResultWebhookPayload(body)
  if (!result) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // Nur an einen Termin, dessen pollUrl auf GENAU diese Abstimmung des eingerichteten Abstimmungstools zeigt - die
  // eventId der Meldung allein reicht nicht (docs/AUDIT-2026-11.md, Beobachtung zur Ergebnis-Meldung, R-02/R-04).
  const event = await prisma.event.findUnique({ where: { id: result.eventId } })
  const origin = abstimmungstoolOrigin()
  if (!event || !origin || !pointsToPoll(event.pollUrl, result.pollId, origin)) {
    return NextResponse.json({ ok: true, note: 'event not found, ignored' })
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      pollResult: JSON.stringify({
        pollTitle: result.pollTitle,
        winners: result.winners,
        closedAt: result.closedAt,
        quorumMet: result.quorumMet,
        unit: result.unit
      })
    }
  })

  return NextResponse.json({ ok: true })
}
