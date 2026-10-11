// app/api/export/kueche/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { loadKitchenReport } from '../../../lib/kitchen'
import { AGE_GROUP_LABEL } from '../../../lib/persons'

/**
 * Personen-CSV der Küchenübersicht (app/lib/kitchen.ts): eine Zeile pro Person mit festem Platz, mit Platz,
 * Altersgruppe, Menüwahl pro Gang, Essen, Allergien und Alkohol. Für alle mit Zugriff auf die Gästeliste.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht autorisiert', { status: 401 })
  const eventId = new URL(request.url).searchParams.get('eventId')
  const event = eventId ? await prisma.event.findUnique({ where: { id: eventId } }) : null
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return new NextResponse('Event nicht gefunden', { status: 404 })

  const report = await loadKitchenReport(event.id)
  const rows = [
    ['Platz', 'Name', 'Antwort', 'Alter', ...report.courses.map(c => c.label), 'Essen', 'Allergien', 'Alkohol'],
    ...report.persons.map(p => [
      p.seat ?? '', p.name, p.answer, AGE_GROUP_LABEL[p.ageGroup].replace(/ \(.*\)$/, ''),
      ...report.courses.map(c => p.menu[c.id] ?? ''), p.dietaryOption ?? '', p.allergies ?? '',
      p.drinksAlcohol === true ? 'Ja' : p.drinksAlcohol === false ? 'Nein' : ''
    ])
  ]
  // Wie die Gästeliste: Semikolon, alles in Anführungszeichen, BOM für Excel. Formeln werden entschärft.
  const cell = (value: string) => `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\n')
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kueche-${event.slug}.csv"` }
  })
}
