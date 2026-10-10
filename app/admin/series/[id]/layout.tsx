// app/admin/series/[id]/layout.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import AdminShell from '../../admin-shell'
import NavLink from '../../nav-link'
import { Badge, ButtonLink } from '../../../ui/kit'
import { loadAdminSeries } from './series-access'

/**
 * Reihen-Seite der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): Kopf der Reihe, Reiter "Termine" und "Einstellungen"
 * (für Moderator*innen nur "Mitglieder"). Jeder Termin hat seine eigene Event-Seite (/admin/events/[id]).
 */
export default async function SeriesLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params
  const loaded = await loadAdminSeries(id)
  if (!loaded) notFound()
  const { user, series, isOwner } = loaded
  const base = `/admin/series/${series.id}`

  return (
    <AdminShell user={user}>
      <div className="mb-4">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Alle Events</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{series.title}</h1>
            {series.description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{series.description}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="purple">Reihe · {series._count.events} Termine</Badge>
              <Badge>{series._count.guestMembers} Mitglieder</Badge>
              {series.eventPin && <Badge>PIN</Badge>}
              {series.requireVerification && <Badge tone="amber">E-Mail-Bestätigung</Badge>}
              {series.requireGuestUser && <Badge tone="indigo">nur mit Konto</Badge>}
              {!isOwner && <Badge tone="teal">freigegeben von {series.owner.email}</Badge>}
            </div>
          </div>
          <ButtonLink href={`/reihe/${series.slug}`} external>Seite der Reihe ↗</ButtonLink>
        </div>
      </div>
      <nav className="-mx-4 mb-6 flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-700" aria-label="Bereiche der Reihe">
        <NavLink href={base} exact variant="tab">Termine</NavLink>
        <NavLink href={`${base}/edit`} variant="tab">{isOwner ? 'Einstellungen und Mitglieder' : 'Mitglieder'}</NavLink>
      </nav>
      {children}
    </AdminShell>
  )
}
