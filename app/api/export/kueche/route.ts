// app/api/export/kueche/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { csvResponse } from '../../../lib/csv'
import { loadKitchenReport } from '../../../lib/kitchen'
import { AGE_GROUP_LABEL } from '../../../lib/persons'

/**
 * Personen-CSV der Küchenübersicht (app/lib/kitchen.ts): eine Zeile pro Person mit festem Platz, mit Tisch, Platz,
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
    ['Tisch', 'Platz', 'Name', 'Antwort', 'Alter', ...report.courses.map(c => c.label), 'Essen', 'Allergien', 'Alkohol'],
    ...report.persons.map(p => [
      p.table ?? '', p.seat ?? '', p.name, p.answer, AGE_GROUP_LABEL[p.ageGroup].replace(/ \(.*\)$/, ''),
      ...report.courses.map(c => p.menu[c.id] ?? ''), p.dietaryOption ?? '', p.allergies ?? '',
      p.drinksAlcohol === true ? 'Ja' : p.drinksAlcohol === false ? 'Nein' : ''
    ])
  ]
  return csvResponse(rows, `kueche-${event.slug}.csv`)
}
