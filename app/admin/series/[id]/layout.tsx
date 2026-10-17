// app/admin/series/[id]/layout.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import AdminShell from '../../admin-shell'
import { Badge, ButtonLink, Tabs } from '../../../ui/kit'
import { loadAdminSeries } from './series-access'

/**
 * Reihen-Seite der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): Kopf der Reihe, Reiter "Termine", im Einladungsmodus
 * "Einladungen" und "Einstellungen" (für Moderator*innen nur "Mitglieder"). Jeder Termin hat seine eigene Event-Seite (/admin/events/[id]).
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
              {series.inviteOnly && <Badge tone="indigo">Nur mit Einladung</Badge>}
              {!isOwner && <Badge tone="teal">freigegeben von {series.owner.email}</Badge>}
            </div>
          </div>
          <ButtonLink href={`/reihe/${series.slug}`} external>Seite der Reihe ↗</ButtonLink>
        </div>
      </div>
      <Tabs label="Bereiche der Reihe" items={[
        { href: base, label: 'Termine', exact: true },
        ...(series.inviteOnly || series._count.invitations > 0 ? [{ href: `${base}/einladungen`, label: 'Einladungen' }] : []),
        { href: `${base}/edit`, label: isOwner ? 'Einstellungen und Mitglieder' : 'Mitglieder' }
      ]} />
      {children}
    </AdminShell>
  )
}
