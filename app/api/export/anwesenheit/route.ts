// app/api/export/anwesenheit/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { presenceReport } from '../../../lib/checkin'

/**
 * Anwesenheitsprotokoll als CSV (Idee L7, Reiter "Anwesenheit"): eine Zeile pro Kommen bzw. Gehen in zeitlicher
 * Reihenfolge, mit Datum, Uhrzeit, Name und Wechsel - lässt sich direkt ins Protokoll übernehmen. Für alle mit
 * Zugriff auf die Gästeliste.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht autorisiert', { status: 401 })
  const eventId = new URL(request.url).searchParams.get('eventId')
  const event = eventId ? await prisma.event.findUnique({ where: { id: eventId } }) : null
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return new NextResponse('Event nicht gefunden', { status: 404 })

  const entries = await prisma.presenceEntry.findMany({ where: { eventId: event.id }, select: { rsvpId: true, position: true, name: true, kind: true, at: true } })
  const { timeline } = presenceReport(entries)
  const date = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = (d: Date) => d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const seen = new Set<string>()
  const rows = [
    ['Datum', 'Uhrzeit', 'Name', 'Wechsel'],
    ...timeline.map(e => {
      const key = `${e.rsvpId}:${e.position ?? ''}`
      const again = e.kind === 'IN' && seen.has(key)
      seen.add(key)
      return [date(e.at), time(e.at), e.name, e.kind === 'OUT' ? 'geht' : again ? 'kommt wieder' : 'kommt']
    })
  ]
  // Wie die Gästeliste: Semikolon, alles in Anführungszeichen, BOM für Excel. Formeln werden entschärft.
  const cell = (value: string) => `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\n')
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="anwesenheit-${event.slug}.csv"` }
  })
}
