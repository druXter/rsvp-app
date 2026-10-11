// app/admin/series/[id]/page.tsx
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { addTerminToSeries } from '../../actions'
import { summarizeEvent } from '../../../lib/event-summary'
import { invitationsForTermin } from '../../../lib/invitations'
import { splitArchived } from '../../../lib/event-date'
import EventRow from '../../event-row'
import DeleteSeriesButton from '../../delete-series-button'
import SubmitButton from '../../../ui/submit-button'
import { EmptyState, inputClass, labelClass } from '../../../ui/kit'
import { loadAdminSeries } from './series-access'

const TERMIN_SUMMARY = {
  rsvps: { select: { isAttending: true, isOnWaitlist: true, hasAttended: true, amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true, persons: { select: { isAttending: true, ageGroup: true, checkedInAt: true } } } },
  _count: { select: { ticketCategories: true, menuCourses: true } }
} satisfies Prisma.EventInclude

/**
 * Reiter "Termine" einer Reihe: aktuelle und (eingeklappt im Archiv, 48 Stunden nach Beginn) vergangene Termine mit Kennzahlen, jeder ein Link zu
 * seiner Event-Seite, dazu "Termin hinzufügen" (Owner/Admin) mit den Grunddaten - alles Weitere in den
 * Einstellungen des Termins.
 */
export default async function SeriesTermine({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminSeries(id)
  if (!loaded) notFound()
  const { series, isOwner } = loaded

  const [events, invitations] = await Promise.all([
    prisma.event.findMany({ where: { seriesId: series.id }, include: TERMIN_SUMMARY, orderBy: { date: 'asc' } }),
    prisma.invitation.findMany({ where: { seriesId: series.id }, select: { allEvents: true, events: { select: { eventId: true } } } })
  ])
  const row = (e: (typeof events)[number]) => ({
    id: e.id, title: e.title, date: e.date, datePending: e.datePending, location: e.location, maxCapacity: e.maxCapacity, inviteOnly: e.inviteOnly,
    hasTickets: e._count.ticketCategories > 0, hasMenu: e._count.menuCourses > 0,
    summary: summarizeEvent(e.rsvps, e.inviteOnly ? invitationsForTermin(invitations, e.id) : null)
  })
  // Wie für Gäste: 48 Stunden nach Beginn wandert ein Termin ins Archiv (isArchived in app/lib/event-date.ts)
  const { current: upcoming, archived: past } = splitArchived(events)

  return (
    <div className="space-y-6">
      {isOwner && (
        <details className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800" open={events.length === 0}>
          <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">+ Termin hinzufügen</summary>
          <form action={addTerminToSeries} className="mt-4 space-y-4">
            <input type="hidden" name="seriesId" value={series.id} />
            <div>
              <label htmlFor="title" className={labelClass}>Titel des Termins</label>
              <input id="title" name="title" required className={inputClass} placeholder={`z.B. ${series.title} - Januar`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="date" className={labelClass}>Datum und Uhrzeit</label>
                <input id="date" type="datetime-local" name="date" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="duration" className={labelClass}>Dauer in Stunden</label>
                <input id="duration" type="number" name="duration" min="1" max="72" defaultValue={4} required className={inputClass} />
              </div>
              <div>
                <label htmlFor="maxCapacity" className={labelClass}>Kapazität (optional)</label>
                <input id="maxCapacity" type="number" name="maxCapacity" min="1" className={inputClass} placeholder="unbegrenzt" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="location" className={labelClass}>Ort (optional)</label>
                <input id="location" name="location" className={inputClass} />
              </div>
              <div>
                <label htmlFor="slug" className={labelClass}>Adresse (URL-Wort, optional)</label>
                <input id="slug" name="slug" className={`${inputClass} font-mono`} placeholder="wird aus dem Titel gebildet" />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Abfragen, Erinnerung, Einlass und alles Weitere stellt ihr danach in den Einstellungen des Termins ein.</p>
            <SubmitButton>Termin anlegen</SubmitButton>
          </form>
        </details>
      )}

      {events.length === 0 && !isOwner && <EmptyState>Diese Reihe hat noch keine Termine.</EmptyState>}
      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Aktuelle Termine</h2>
          <div className="grid gap-3">{upcoming.map(e => <EventRow key={e.id} event={row(e)} />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <details className="group">
          <summary className="mb-3 cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span className="inline-block transition group-open:rotate-90">▸</span> 🗄️ Archiv ({past.length} vergangene{past.length === 1 ? 'r' : ''} Termin{past.length === 1 ? '' : 'e'})
          </summary>
          <div className="grid gap-3">{past.map(e => <EventRow key={e.id} event={row(e)} muted />)}</div>
        </details>
      )}

      {isOwner && (
        <div className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-gray-800">
          <h2 className="font-semibold text-red-800 dark:text-red-300">Reihe löschen</h2>
          <p className="mt-1 mb-3 text-sm text-gray-600 dark:text-gray-400">Löscht die Reihe mit allen Terminen, Antworten und Profilen der Gäste. Das lässt sich nicht rückgängig machen.</p>
          <DeleteSeriesButton seriesId={series.id} />
        </div>
      )}
    </div>
  )
}
