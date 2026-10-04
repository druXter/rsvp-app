// app/admin/series-termine.tsx
import { ReactNode } from 'react'
import EventRsvpCard, { EventForCard } from './event-rsvp-card'
import { splitArchived } from '../lib/event-date'

/**
 * Termin-Liste einer Reihe in der Verwaltung: aktuelle Termine wie bisher, Termine, die vor
 * mehr als 48 Stunden begonnen haben (isArchived), in einem eingeklappten "Archiv" darunter -
 * neueste zuerst. Gästeliste, CSV-Export & Co. bleiben dort vollständig erreichbar.
 */
export default function SeriesTermine({
  events,
  requireVerification,
  access,
  empty
}: {
  events: EventForCard[]
  requireVerification: boolean
  access: 'owner' | 'moderator'
  empty: ReactNode
}) {
  if (events.length === 0) return <>{empty}</>
  const { current, archived } = splitArchived(events)

  return (
    <>
      {current.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">Keine anstehenden Termine.</p>
      )}
      {current.map(event => (
        <EventRsvpCard key={event.id} event={event} requireVerification={requireVerification} access={access} />
      ))}
      {archived.length > 0 && (
        <details className="group bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-300">
            <span>🗄️ Archiv ({archived.length} {archived.length === 1 ? 'vergangener Termin' : 'vergangene Termine'})</span>
            <span className="text-gray-400 dark:text-gray-500 font-normal group-open:hidden">Anzeigen ▾</span>
            <span className="text-gray-400 dark:text-gray-500 font-normal hidden group-open:inline">Verbergen ▴</span>
          </summary>
          <div className="mt-4 space-y-6">
            {archived.map(event => (
              <EventRsvpCard key={event.id} event={event} requireVerification={requireVerification} access={access} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}
