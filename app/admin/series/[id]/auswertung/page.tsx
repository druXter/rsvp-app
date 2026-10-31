// app/admin/series/[id]/auswertung/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { formatPercent, MATCHED_BY_LABELS, personRate, SERIES_STATS_SELECT, seriesStats } from '../../../../lib/series-stats'
import { Badge, Card, EmptyState, ProgressBar, Stat, buttonClass, formatShortDate } from '../../../../ui/kit'
import { loadAdminSeries } from '../series-access'

const th = 'px-3 py-2 font-medium'
const td = 'px-3 py-2 tabular-nums'

/**
 * Reiter „Auswertung“ einer Reihe (Idee L31, app/lib/series-stats.ts): Teilnahme pro Termin als Verlauf, Quote
 * „zugesagt und erschienen“ (Termine mit QR-Einlass) und Personen über alle vergangenen Termine - Stammgäste und wer
 * nach einer Zusage fehlt. Für alle mit Zugriff auf die Reihe (wie die Gästelisten ihrer Termine). Alles wird aus den
 * gespeicherten Antworten berechnet; nach Ablauf der Löschfristen fehlen die Termine auch hier.
 */
export default async function SeriesStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminSeries(id)
  if (!loaded) notFound()
  const { series } = loaded

  const events = await prisma.event.findMany({ where: { seriesId: series.id }, select: SERIES_STATS_SELECT })
  if (events.length === 0) return <EmptyState>Diese Reihe hat noch keine Termine.</EmptyState>
  const stats = seriesStats(events)
  const maxConfirmed = Math.max(1, ...stats.termine.map(t => t.maxCapacity ?? t.confirmed))
  const withCheckin = stats.termine.some(t => t.attended !== null)
  const withLapsed = stats.termine.some(t => t.lapsed > 0)
  const regulars = stats.persons.filter(p => p.regular).length
  const csv = (art: string) => `/api/export/reihe?seriesId=${series.id}&art=${art}`

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="series-stats">
        <Stat label="Vergangene Termine" value={stats.pastCount} hint={`von ${events.length}`} testId="stat-past" />
        <Stat label="Zusagen im Schnitt" value={stats.avgConfirmed === null ? '-' : stats.avgConfirmed.toLocaleString('de-DE', { maximumFractionDigits: 1 })} hint="pro vergangenem Termin" testId="stat-average" />
        <Stat label="Zugesagt und erschienen" value={formatPercent(stats.attendanceRate)} testId="stat-rate"
          hint={stats.checkinTermine > 0 ? `${stats.checkinTermine} Termin${stats.checkinTermine === 1 ? '' : 'e'} mit Einlass` : 'braucht Termine mit QR-Einlass'} />
        <Stat label="Stammgäste" value={regulars} hint={`bei mindestens ${stats.regularThreshold} Terminen zugesagt`} testId="stat-regulars" />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Verlauf pro Termin</h2>
          <a href={csv('termine')} download className={buttonClass('secondary', 'sm')}>CSV</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="stats-termine">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              <tr>
                <th className={th}>Termin</th>
                <th className={`${th} w-40`}>Zusagen</th>
                <th className={th}>Warteliste</th>
                <th className={th}>Vielleicht</th>
                <th className={th}>Absagen</th>
                {withLapsed && <th className={th}>Verfallen</th>}
                {withCheckin && <th className={th}>Erschienen</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {stats.termine.map(t => (
                <tr key={t.id} className={t.past ? '' : 'text-gray-500 dark:text-gray-400'} data-testid="stats-termin">
                  <td className="px-3 py-2">
                    <Link href={`/admin/events/${t.id}`} className="font-medium text-gray-900 hover:underline dark:text-gray-100">{t.title}</Link>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{formatShortDate(t.date, t.datePending)}{t.past ? '' : ' · anstehend'}</div>
                  </td>
                  <td className={td}>
                    {t.confirmed}{t.maxCapacity !== null && <span className="text-gray-500 dark:text-gray-400"> / {t.maxCapacity}</span>}
                    <ProgressBar value={t.confirmed} max={t.maxCapacity ?? maxConfirmed} label={`Zusagen ${t.title}`} />
                  </td>
                  <td className={td}>{t.waitlist}</td>
                  <td className={td}>{t.maybe}</td>
                  <td className={td}>{t.declined}</td>
                  {withLapsed && <td className={td}>{t.lapsed}</td>}
                  {withCheckin && <td className={td}>{t.attended === null ? '-' : `${t.attended} (${formatPercent(t.confirmed > 0 ? t.attended / t.confirmed : null)})`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Personen</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Über alle vergangenen Termine, zusammengeführt über Teilnehmendenkonto, bestätigte E-Mail-Adresse oder persönlichen Link. Nur für die Verwaltung.
            </p>
          </div>
          {stats.persons.length > 0 && <a href={csv('personen')} download className={buttonClass('secondary', 'sm')}>CSV</a>}
        </div>
        {stats.persons.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Noch keine vergangenen Termine mit Antworten.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="stats-personen">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Zusagen</th>
                  {withCheckin && <th className={th}>Erschienen</th>}
                  {withCheckin && <th className={th} title="Zugesagt, aber nicht eingecheckt (nur Termine mit Einlass)">Gefehlt</th>}
                  <th className={th}>Absagen</th>
                  {withLapsed && <th className={th}>Verfallen</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {stats.persons.map(p => (
                  <tr key={p.key} data-testid="stats-person">
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100" title={`Erkannt über: ${MATCHED_BY_LABELS[p.matchedBy]}`}>{p.name}</span>
                      {p.regular && <> <Badge tone="green">Stammgast</Badge></>}
                    </td>
                    <td className={td}>{p.confirmed} / {stats.pastCount}</td>
                    {withCheckin && <td className={td}>{p.attended}{personRate(p) !== null ? ` (${formatPercent(personRate(p))})` : ''}</td>}
                    {withCheckin && <td className={td}>{p.noShow > 0 ? <Badge tone={p.noShow >= 2 ? 'amber' : 'gray'}>{p.noShow}</Badge> : 0}</td>}
                    <td className={td}>{p.declined}</td>
                    {withLapsed && <td className={td}>{p.lapsed}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
