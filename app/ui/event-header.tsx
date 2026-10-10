// app/ui/event-header.tsx
import { formatEventDate } from '../lib/event-date'

/**
 * Kopf der Gästeseite (docs/KONZEPT-OBERFLAECHE.md): Titel, Datum, Ort und Beschreibung des Events über dem
 * Formular. Im Einladungsmodus erscheint er erst mit gültigem Einladungslink (vorher nur InvitationGate).
 */
export default function EventHeader({ event, seriesTitle }: {
  event: { title: string; date: Date; datePending: boolean; duration: number; location: string | null; description: string | null }
  seriesTitle?: string | null
}) {
  return (
    <header className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="event-header">
      {seriesTitle && <p className="text-xs font-medium uppercase tracking-wide text-purple-700 dark:text-purple-300">{seriesTitle}</p>}
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 sm:text-3xl break-words">{event.title}</h1>
      <dl className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex gap-2"><dt aria-label="Wann">📅</dt><dd>{formatEventDate(event)}{!event.datePending && event.duration ? ` · ca. ${event.duration} Std.` : ''}</dd></div>
        {event.location && <div className="flex gap-2"><dt aria-label="Wo">📍</dt><dd>{event.location}</dd></div>}
      </dl>
      {event.description && <p className="mt-4 whitespace-pre-line text-gray-700 dark:text-gray-300">{event.description}</p>}
    </header>
  )
}
