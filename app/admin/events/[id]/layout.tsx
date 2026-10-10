// app/admin/events/[id]/layout.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import AdminShell from '../../admin-shell'
import NavLink from '../../nav-link'
import { Badge, ButtonLink, formatShortDate } from '../../../ui/kit'
import { eventTabs, guestPageOf, loadAdminEvent } from './event-access'

/**
 * Event-Seite der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): Kopf mit Titel, Datum, Ort und Merkmalen, darunter
 * Reiter - Übersicht, Gäste, je nach genutzten Funktionen Einladungen, Küche, Zahlungen, und für Owner/Admins die
 * Einstellungen. Moderator*innen mit Freigabe sehen alles außer den Einstellungen.
 */
export default async function EventLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { user, event, isOwner } = loaded

  return (
    <AdminShell user={user}>
      <div className="mb-4 print:hidden">
        <Link href={event.series ? `/admin/series/${event.series.id}` : '/admin'} className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
          ← {event.series ? event.series.title : 'Alle Events'}
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 break-words">{event.title}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {formatShortDate(event.date, event.datePending)}{event.location ? ` · ${event.location}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.series && <Badge tone="purple">Reihe: {event.series.title}</Badge>}
              {event.inviteOnly && <Badge tone="indigo">Nur mit Einladung</Badge>}
              {event.eventPin && !event.series && <Badge>PIN</Badge>}
              {(event.series ? event.series.requireVerification : event.requireVerification) && <Badge tone="amber">E-Mail-Bestätigung</Badge>}
              {event.enableCheckin && <Badge tone="teal">Einlass mit QR-Code</Badge>}
              {!isOwner && <Badge tone="teal">freigegeben von {event.owner.email}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={guestPageOf(event)} external>Gästeseite ↗</ButtonLink>
          </div>
        </div>
      </div>
      <nav className="-mx-4 mb-6 flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-700 print:hidden" aria-label="Bereiche des Events">
        {eventTabs(loaded).map(tab => <NavLink key={tab.href} href={tab.href} exact={tab.exact} variant="tab">{tab.label}</NavLink>)}
      </nav>
      {children}
    </AdminShell>
  )
}
