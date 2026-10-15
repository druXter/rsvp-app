// app/admin/events/[id]/anwesenheit/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { presenceReport, presentPersons } from '../../../../lib/checkin'
import { formatPresenceTime } from '../../../../lib/presence-format'
import { EmptyState, Stat, buttonClass } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import PrintButton from '../kueche/print-button'
import AutoRefresh from './auto-refresh'

/**
 * Reiter "Anwesenheit" (Idee L7, Event.trackPresence): wer gerade da ist, pro Person alle Aufenthalte (kommen bis
 * gehen) und der Verlauf aller Wechsel - die Grundlage fürs Sitzungsprotokoll ("verlässt um 20:15 die Sitzung").
 * Druckbar, dazu die CSV. Aktualisiert sich alle 15 Sekunden. Für alle mit Zugriff auf die Gästeliste.
 */
export default async function PresencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event } = loaded

  const [entries, rsvps] = await Promise.all([
    prisma.presenceEntry.findMany({ where: { eventId: event.id }, select: { rsvpId: true, position: true, name: true, kind: true, at: true } }),
    prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: { isAttending: true, isOnWaitlist: true, hasAttended: true, leftAt: true, persons: { select: { isAttending: true, checkedInAt: true, leftAt: true } } }
    })
  ])
  const report = presenceReport(entries)
  const fmt = (d: Date) => formatPresenceTime(d, event.date)
  const seen = new Set<string>()
  // "kommt wieder" statt "kommt", wenn die Person schon einmal da war
  const timeline = report.timeline.map(e => {
    const key = `${e.rsvpId}:${e.position ?? ''}`
    const again = e.kind === 'IN' && seen.has(key)
    seen.add(key)
    return { ...e, text: e.kind === 'OUT' ? 'geht' : again ? 'kommt wieder' : 'kommt' }
  })

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 print:border-0 print:p-0 print:shadow-none">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Anwesenheit<span className="hidden print:inline">: {event.title}</span></h2>
        <div className="flex items-center gap-2 print:hidden">
          <a href={`/api/export/anwesenheit?eventId=${event.id}`} download className={buttonClass('secondary')}>📥 CSV</a>
          <PrintButton />
        </div>
      </div>

      {!event.trackPresence && (
        <p className="text-sm text-amber-700 dark:text-amber-300 print:hidden">„Kommen und Gehen protokollieren“ ist aus - neue Wechsel werden nicht mehr erfasst.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Jetzt da" value={presentPersons(rsvps)} hint="Personen" testId="presence-now" />
        <Stat label="Da gewesen" value={report.rows.length} hint="laut Protokoll" />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState>Noch niemand eingecheckt. Kommen und Gehen erscheinen hier, sobald am Einlass gescannt oder in der Gästeliste eingecheckt wird.</EmptyState>
      ) : (
        <>
          <section>
            <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Personen</h3>
            <table className="w-full text-sm" data-testid="presence-list">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Da</th><th className="py-1 font-medium">Jetzt</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {report.rows.map(row => (
                  <tr key={`${row.rsvpId}:${row.position ?? ''}`} className="break-inside-avoid">
                    <td className="py-1.5 pr-3 font-medium text-gray-900 dark:text-gray-100">{row.name}</td>
                    <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{row.stays.map(s => `${fmt(s.from)}–${s.to ? fmt(s.to) : ''}`).join(', ')}</td>
                    <td className="py-1.5">{row.present ? <span className="text-green-700 dark:text-green-400">da</span> : <span className="text-gray-500 dark:text-gray-400">gegangen</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Verlauf</h3>
            <ol className="space-y-1 text-sm" data-testid="presence-timeline">
              {timeline.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{fmt(e.at)}</span>
                  <span className="text-gray-900 dark:text-gray-100">{e.name} {e.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  )
}
