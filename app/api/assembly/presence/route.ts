// app/api/assembly/presence/route.ts
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '../../../lib/prisma'
import { isConfirmedRsvp } from '../../../lib/linked-tools'
import { checkInAll, checkOutAll, isPresent, leaveAll } from '../../../lib/checkin'
import { assemblyOf, rsvpOfSubject, verifyPresenceChange } from '../../../lib/assembly'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }

/**
 * Ein- und Auschecken aus dem Abstimmungstool (Idee L7, app/lib/assembly.ts): die Sitzungsleitung für andere, ohne Scan,
 * oder ein Mitglied für sich selbst (wenn die Sitzung das erlaubt - das prüft das Abstimmungstool). Wirkt wie der Knopf
 * in der Gästeliste: Einchecken lässt alle zusagenden Personen der Antwort herein, Auschecken heißt mit Kommen und
 * Gehen "geht" (Protokoll), sonst Austragen. Nur für einen Termin mit QR-Einlass, der genau diese Sitzung verlinkt, und
 * nur für Zusagen, die zählen.
 */
export async function POST(request: Request) {
  const change = verifyPresenceChange(await request.text())
  if (!change) return new NextResponse('invalid', { status: 401, headers })

  const event = await prisma.event.findUnique({ where: { id: change.eventId }, include: { series: true } })
  if (!event || assemblyOf(event)?.assemblyId !== change.assemblyId) return new NextResponse('not linked', { status: 404, headers })
  if (!event.enableCheckin) return new NextResponse('no checkin', { status: 409, headers })

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId: event.id, isAttending: true, isOnWaitlist: false },
    select: { id: true, isAttending: true, isOnWaitlist: true, hasAttended: true, leftAt: true, participant: { select: { isVerified: true } } }
  })
  const rsvp = rsvpOfSubject(change.assemblyId, rsvps.filter(r => isConfirmedRsvp(r, r.participant, requireVerification)), change.sub)
  if (!rsvp) return new NextResponse('unknown member', { status: 404, headers })

  if (change.present) await checkInAll(rsvp.id)
  else if (isPresent(rsvp)) await (event.trackPresence ? leaveAll(rsvp.id) : checkOutAll(rsvp.id))

  revalidatePath('/admin', 'layout')
  return NextResponse.json({ ok: true }, { headers })
}
