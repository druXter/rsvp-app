// app/api/assembly/roster/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { assemblyOf, signRosterResult, verifyRosterRequest } from '../../../lib/assembly'
import { readLimitedText } from '../../../lib/linked-tools'

// Größere Nachrichten verschickt das Abstimmungstool nie; alles darüber wird gar nicht erst gelesen.
const MAX_BODY = 20_000

export const dynamic = 'force-dynamic'

/**
 * Anwesenheit für eine Sitzung im Abstimmungstool (Idee L7, app/lib/assembly.ts): Die signierte Anfrage nennt Sitzung
 * und Termin; geantwortet wird nur, wenn dieser Termin genau diese Sitzung verlinkt - mit den Pseudonymen der
 * Anwesenden (keine Namen), der Zahl der Zusagen und ob der Termin QR-Einlass hat, ebenfalls signiert.
 */
export async function POST(request: Request) {
  const query = verifyRosterRequest(await readLimitedText(request, MAX_BODY))
  if (!query) return new NextResponse('invalid', { status: 401, headers: { 'Cache-Control': 'no-store' } })

  const event = await prisma.event.findUnique({ where: { id: query.eventId }, include: { series: true } })
  if (!event || assemblyOf(event)?.assemblyId !== query.assemblyId) return new NextResponse('not linked', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const rsvps = await prisma.rsvp.findMany({
    where: { eventId: event.id, isAttending: true, isOnWaitlist: false },
    select: { id: true, isAttending: true, isOnWaitlist: true, hasAttended: true, leftAt: true, participant: { select: { isVerified: true } } }
  })
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const body = signRosterResult(query.assemblyId, event, rsvps, requireVerification)
  if (!body) return new NextResponse('not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}
