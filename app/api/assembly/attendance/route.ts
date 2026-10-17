// app/api/assembly/attendance/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { assemblyOf, signAttendanceResult, verifyAttendanceRequest } from '../../../lib/assembly'

export const dynamic = 'force-dynamic'

/**
 * Anwesenheitsliste für die Sitzungsleitung im Abstimmungstool (Idee L7, app/lib/assembly.ts): alle Zusagen, die zählen,
 * mit Pseudonym, Namen und ob sie gerade da sind - damit die Sitzungsleitung andere ohne Scan ein- und auschecken kann.
 * Nur für einen Termin, der genau diese Sitzung verlinkt. Keine E-Mail, keine Rsvp-ID; die Antwort ist signiert.
 */
export async function POST(request: Request) {
  const query = verifyAttendanceRequest(await request.text())
  if (!query) return new NextResponse('invalid', { status: 401, headers: { 'Cache-Control': 'no-store' } })

  const event = await prisma.event.findUnique({ where: { id: query.eventId }, include: { series: true } })
  if (!event || assemblyOf(event)?.assemblyId !== query.assemblyId) return new NextResponse('not linked', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const rsvps = await prisma.rsvp.findMany({
    where: { eventId: event.id, isAttending: true, isOnWaitlist: false },
    select: { id: true, isAttending: true, isOnWaitlist: true, hasAttended: true, leftAt: true, participant: { select: { isVerified: true, name: true } } }
  })
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const body = signAttendanceResult(query.assemblyId, event, rsvps, requireVerification)
  if (!body) return new NextResponse('not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}
