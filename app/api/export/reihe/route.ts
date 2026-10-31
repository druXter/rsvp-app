import { csvResponse } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasSeriesModeratorOrAbove } from '../../../lib/permissions'
import { formatPercent, MATCHED_BY_LABELS, personRate, SERIES_STATS_SELECT, seriesStats } from '../../../lib/series-stats'

/**
 * Auswertung einer Reihe als CSV (Idee L31, Reiter „Auswertung“): `art=termine` eine Zeile pro Termin, `art=personen`
 * eine pro Person über alle vergangenen Termine (nur Namen, keine Kontaktdaten). Für alle mit Zugriff auf die Reihe.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht autorisiert', { status: 401 })
  const params = new URL(request.url).searchParams
  const seriesId = params.get('seriesId')
  const series = seriesId ? await prisma.eventSeries.findUnique({ where: { id: seriesId } }) : null
  if (!series || !(await hasSeriesModeratorOrAbove(user, series))) return new NextResponse('Reihe nicht gefunden', { status: 404 })

  const stats = seriesStats(await prisma.event.findMany({ where: { seriesId: series.id }, select: SERIES_STATS_SELECT }))
  const date = (d: Date, pending: boolean) => pending ? 'offen' : d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })

  if (params.get('art') === 'personen') {
    const rows = [
      ['Name', 'Erkannt über', 'Zusagen', 'Vergangene Termine', 'Erschienen', 'Gefehlt', 'Quote erschienen', 'Absagen', 'Verfallen', 'Stammgast'],
      ...stats.persons.map(p => [
        p.name, MATCHED_BY_LABELS[p.matchedBy], String(p.confirmed), String(stats.pastCount), String(p.attended), String(p.noShow),
        formatPercent(personRate(p)), String(p.declined), String(p.lapsed), p.regular ? 'ja' : 'nein'
      ])
    ]
    return csvResponse(rows, `auswertung-personen-${series.slug}.csv`)
  }
  const rows = [
    ['Termin', 'Datum', 'Stand', 'Zusagen', 'Plätze', 'Kapazität', 'Warteliste', 'Vielleicht', 'Absagen', 'Verfallen', 'Erschienen', 'Quote erschienen'],
    ...stats.termine.map(t => [
      t.title, date(t.date, t.datePending), t.past ? 'vergangen' : 'anstehend', String(t.confirmed), String(t.seats), t.maxCapacity === null ? '' : String(t.maxCapacity),
      String(t.waitlist), String(t.maybe), String(t.declined), String(t.lapsed), t.attended === null ? '' : String(t.attended),
      t.attended === null ? '' : formatPercent(t.confirmed > 0 ? t.attended / t.confirmed : null)
    ])
  ]
  return csvResponse(rows, `auswertung-termine-${series.slug}.csv`)
}
