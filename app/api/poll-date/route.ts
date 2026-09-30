// app/api/poll-date/route.ts
import { NextResponse } from 'next/server'
import { verifyPollDateMessage } from '../../lib/poll-verification'
import { abstimmungstoolOrigin, applyPollDate, pollDateStatus } from '../../lib/poll-date'

/**
 * Terminabstimmung: Anfragen des Abstimmungstools (siehe app/lib/poll-date.ts). Body ist die
 * signierte Nachricht selbst (text/plain), wie bei /api/poll-result-webhook.
 * - poll-date-status: Welche Events zeigen auf die Abstimmung, darf ein neues angelegt werden?
 * - poll-date-set:    Der festgelegte Termin - in verknüpfte Events mit offenem Datum
 *                     übernehmen oder (falls gewünscht und erlaubt) ein neues Event anlegen.
 */
export async function POST(request: Request) {
  const origin = abstimmungstoolOrigin()
  if (!origin) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const message = verifyPollDateMessage(await request.text())
  if (!message) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  if (message.typ === 'poll-date-status') {
    return NextResponse.json({ ok: true, ...(await pollDateStatus(message.pollId, message.owner, origin)) })
  }
  return NextResponse.json({ ok: true, ...(await applyPollDate(message, origin)) })
}
