// app/admin/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getCurrentUser } from '../lib/auth'
import { isPastEvent, summarizeEvent } from '../lib/event-summary'
import { invitationsForTermin } from '../lib/invitations'
import AdminShell from './admin-shell'
import EventRow, { type EventRowData } from './event-row'
import { Badge, ButtonLink, EmptyState, PageHeader } from '../ui/kit'

/** Was die Übersicht pro Termin braucht - bewusst ohne Gästedaten (die stehen auf der Event-Seite). */
const EVENT_SUMMARY = {
  rsvps: {
    select: {
      isAttending: true, isMaybe: true, isOnWaitlist: true, hasAttended: true, amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true,
      persons: { select: { isAttending: true, ageGroup: true, checkedInAt: true } }
    }
  },
  owner: { select: { email: true } },
  _count: { select: { invitations: true, ticketCategories: true, menuCourses: true } }
} satisfies Prisma.EventInclude

type SummaryEvent = Prisma.EventGetPayload<{ include: typeof EVENT_SUMMARY }>

/** invitationCount: bei Reihen-Terminen die Einladungen der Reihe für diesen Termin (sonst die eigenen des Events). */
function toRow(event: SummaryEvent, viewerEmail: string, sharedBy: string | null = null, invitationCount = event._count.invitations): EventRowData {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    datePending: event.datePending,
    location: event.location,
    maxCapacity: event.maxCapacity,
    inviteOnly: event.inviteOnly,
    hasTickets: event._count.ticketCategories > 0,
    hasMenu: event._count.menuCourses > 0,
    summary: summarizeEvent(event.rsvps, event.inviteOnly ? invitationCount : null),
    ownerEmail: !sharedBy && event.owner.email !== viewerEmail ? event.owner.email : null,
    sharedBy
  }
}

/**
 * Übersicht der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): anstehende Events, Reihen mit ihrem nächsten Termin und
 * eingeklappt die vergangenen - jeweils mit den wichtigsten Zahlen. Gästelisten, Einladungen, Zahlungen und
 * Einstellungen liegen auf der Event-Seite (/admin/events/[id]). Admins sehen alle Konten, Moderator*innen nur,
 * was ihnen freigegeben wurde.
 */
export default async function AdminDashboard() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const isAdmin = user.role === 'ADMIN'
  const isModerator = user.role === 'MODERATOR'

  const access = isAdmin ? [] : await prisma.resourceAccess.findMany({ where: { userId: user.id }, select: { eventId: true, seriesId: true } })
  const sharedEventIds = access.map(a => a.eventId).filter((id): id is string => !!id)
  const sharedSeriesIds = access.map(a => a.seriesId).filter((id): id is string => !!id)

  const [ownEvents, sharedEvents, series] = await Promise.all([
    prisma.event.findMany({ where: { seriesId: null, ...(isAdmin ? {} : { ownerId: user.id }) }, include: EVENT_SUMMARY, orderBy: { date: 'asc' } }),
    sharedEventIds.length > 0
      ? prisma.event.findMany({ where: { id: { in: sharedEventIds }, ownerId: { not: user.id } }, include: EVENT_SUMMARY, orderBy: { date: 'asc' } })
      : Promise.resolve([]),
    prisma.eventSeries.findMany({
      where: isAdmin ? {} : { OR: [{ ownerId: user.id }, { id: { in: sharedSeriesIds } }] },
      include: { owner: { select: { email: true } }, events: { include: EVENT_SUMMARY, orderBy: { date: 'asc' } }, invitations: { select: { allEvents: true, events: { select: { eventId: true } } } } },
      orderBy: { createdAt: 'asc' }
    })
  ])

  // Freigegebene Termine einer Reihe, die hier schon als Ganzes steht, nicht doppelt zeigen
  const seriesIds = new Set(series.map(s => s.id))
  const all = [...ownEvents.map(e => ({ e, shared: null as string | null })), ...sharedEvents.filter(e => !e.seriesId || !seriesIds.has(e.seriesId)).map(e => ({ e, shared: e.owner.email }))]
  const upcoming = all.filter(x => !isPastEvent(x.e)).sort((a, b) => a.e.date.getTime() - b.e.date.getTime()).map(x => toRow(x.e, user.email, x.shared))
  const past = all.filter(x => isPastEvent(x.e)).sort((a, b) => b.e.date.getTime() - a.e.date.getTime()).map(x => toRow(x.e, user.email, x.shared))

  return (
    <AdminShell user={user}>
      <PageHeader
        title="Events"
        subtitle={isAdmin ? 'Alle Events und Reihen aller Konten' : isModerator ? 'Für dich freigegebene Events und Reihen' : undefined}
        actions={!isModerator && (
          <>
            <ButtonLink href="/admin/series/create">+ Neue Reihe</ButtonLink>
            <ButtonLink href="/admin/create" variant="primary">+ Neues Event</ButtonLink>
          </>
        )}
      />

      {all.length === 0 && series.length === 0 && (
        <EmptyState>
          {isModerator ? 'Dir wurde noch kein Event und keine Reihe freigegeben.' : 'Noch keine Events. Leg mit „+ Neues Event“ dein erstes an.'}
        </EmptyState>
      )}

      {upcoming.length > 0 && (
        <section className="mb-8" aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Anstehend</h2>
          <div className="grid gap-3">{upcoming.map(r => <EventRow key={r.id} event={r} />)}</div>
        </section>
      )}

      {series.length > 0 && (
        <section className="mb-8" aria-labelledby="series">
          <h2 id="series" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Reihen</h2>
          <div className="grid gap-4">
            {series.map(s => {
              const next = s.events.filter(e => !isPastEvent(e))
              return (
                <div key={s.id} className="rounded-xl border border-purple-200 bg-purple-50/50 p-3 dark:border-purple-900 dark:bg-purple-950/30" data-testid="series-card">
                  <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                    <Link href={`/admin/series/${s.id}`} className="font-semibold text-purple-900 hover:underline dark:text-purple-200">{s.title}</Link>
                    <Badge tone="purple">Reihe · {s.events.length} Termine</Badge>
                    {!isAdmin && s.ownerId !== user.id && <Badge tone="teal" title={`freigegeben von ${s.owner.email}`}>freigegeben</Badge>}
                    {isAdmin && s.owner.email !== user.email && <span className="text-xs text-gray-500 dark:text-gray-400">{s.owner.email}</span>}
                    <Link href={`/admin/series/${s.id}`} className="ml-auto text-sm text-purple-800 hover:underline dark:text-purple-300">Alle Termine →</Link>
                  </div>
                  {next.length === 0
                    ? <p className="px-1 pb-1 text-sm text-gray-500 dark:text-gray-400">Kein anstehender Termin.</p>
                    : <div className="grid gap-2">{next.slice(0, 2).map(e => <EventRow key={e.id} event={toRow(e, user.email, null, invitationsForTermin(s.invitations, e.id))} />)}</div>}
                  {next.length > 2 && <p className="px-1 pt-2 text-xs text-gray-500 dark:text-gray-400">… und {next.length - 2} weitere anstehende Termine</p>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <details className="group" data-testid="past-events">
          <summary className="mb-3 cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span className="inline-block transition group-open:rotate-90">▸</span> Vergangen ({past.length})
          </summary>
          <div className="grid gap-3">{past.map(r => <EventRow key={r.id} event={r} muted />)}</div>
        </details>
      )}
    </AdminShell>
  )
}
