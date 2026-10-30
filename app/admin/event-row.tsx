// app/admin/event-row.tsx
import Link from 'next/link'
import { Badge, ProgressBar } from '../ui/kit'
import { formatEuro } from '../lib/payment-state'
import type { EventSummary } from '../lib/event-summary'

export type EventRowData = {
  id: string
  title: string
  date: Date
  datePending: boolean
  location: string | null
  maxCapacity: number | null
  inviteOnly: boolean
  hasTickets: boolean
  hasMenu: boolean
  summary: EventSummary
  ownerEmail?: string | null
  sharedBy?: string | null
}

const MONTH = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', month: 'short' })
const DAY = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit' })
const TIME = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const YEAR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric' })

/**
 * Ein Termin in der Übersicht (docs/KONZEPT-OBERFLAECHE.md): Datum, Titel, Merkmale und die wichtigsten Zahlen,
 * als Ganzes ein Link zur Event-Seite. `muted` für vergangene Termine.
 */
export default function EventRow({ event, muted = false }: { event: EventRowData; muted?: boolean }) {
  const s = event.summary
  const thisYear = YEAR.format(new Date()) === YEAR.format(event.date)
  return (
    <Link
      href={`/admin/events/${event.id}`}
      className={`group flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700 ${muted ? 'opacity-75' : ''}`}
      data-testid="event-row"
    >
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-gray-50 py-2 text-center dark:bg-gray-900">
        {event.datePending ? (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">offen</span>
        ) : (
          <>
            <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{MONTH.format(event.date)}</span>
            <span className="text-xl font-semibold leading-tight text-gray-900 dark:text-gray-100">{DAY.format(event.date)}</span>
            {!thisYear && <span className="text-[10px] text-gray-500 dark:text-gray-400">{YEAR.format(event.date)}</span>}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">{event.title}</span>
          {event.inviteOnly && <Badge tone="indigo">Einladungen</Badge>}
          {event.hasTickets && <Badge tone="pink">Tickets</Badge>}
          {event.hasMenu && <Badge tone="orange">Menü</Badge>}
          {event.sharedBy && <Badge tone="teal" title={`freigegeben von ${event.sharedBy}`}>freigegeben</Badge>}
        </div>
        <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
          {event.datePending ? 'Datum wird abgestimmt' : TIME.format(event.date)}{event.location ? ` · ${event.location}` : ''}
          {event.ownerEmail ? ` · ${event.ownerEmail}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300" data-testid="event-row-stats">
          <span><strong className="font-semibold">{s.confirmed}</strong> {s.confirmed === 1 ? 'Zusage' : 'Zusagen'}{s.seats !== s.confirmed && <> · {s.seats} Personen</>}</span>
          {s.declined > 0 && <span className="text-gray-500 dark:text-gray-400">{s.declined} Absagen</span>}
          {s.maybe > 0 && <Badge tone="blue">{s.maybe} vielleicht</Badge>}
          {s.waitlist > 0 && <Badge tone="orange">{s.waitlist} Warteliste</Badge>}
          {s.invitationsOpen !== null && s.invitationsOpen > 0 && <Badge tone="indigo">{s.invitationsOpen} Einladungen offen</Badge>}
          {s.paymentsOpen > 0 && <Badge tone={s.paymentsOverdue > 0 ? 'red' : 'pink'}>{formatEuro(s.openCents)} offen{s.paymentsOverdue > 0 ? ` · ${s.paymentsOverdue} überfällig` : ''}</Badge>}
        </div>
        {event.maxCapacity !== null && (
          <div className="mt-2 max-w-xs">
            <ProgressBar value={s.seats} max={event.maxCapacity} label="Plätze belegt" />
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{s.seats} von {event.maxCapacity} Plätzen</p>
          </div>
        )}
      </div>
    </Link>
  )
}
