// app/admin/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { logoutUser } from './actions'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '../lib/auth'
import { ROLE_LABELS } from '../lib/permissions'
import EventRsvpCard from './event-rsvp-card'
import DeleteSeriesButton from './delete-series-button'
import PushSubscribeButton from './push-subscribe-button'

const prisma = new PrismaClient()

const rsvpInclude = {
  rsvps: {
    include: { participant: true },
    orderBy: { createdAt: 'desc' as const }
  }
}

/**
 * Eigene (bzw. bei Admins: alle) Einzel-Events.
 */
const getStandaloneEvents = (userId: string, isAdmin: boolean) => {
  return prisma.event.findMany({
    where: { seriesId: null, ...(isAdmin ? {} : { ownerId: userId }) },
    include: { ...rsvpInclude, owner: { select: { email: true } } },
    orderBy: { date: 'asc' }
  })
}

/**
 * Eigene (bzw. bei Admins: alle) Veranstaltungsreihen.
 */
const getSeries = (userId: string, isAdmin: boolean) => {
  return prisma.eventSeries.findMany({
    where: isAdmin ? {} : { ownerId: userId },
    include: {
      events: { include: rsvpInclude, orderBy: { date: 'asc' } },
      owner: { select: { email: true } }
    },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * Reihen, auf die dieser Nutzer per ResourceAccess Moderator-Zugriff hat (nicht seine eigenen).
 */
const getSharedSeries = async (userId: string) => {
  const access = await prisma.resourceAccess.findMany({ where: { userId, seriesId: { not: null } }, select: { seriesId: true } })
  const seriesIds = access.map(a => a.seriesId!).filter(Boolean)
  if (seriesIds.length === 0) return []
  return prisma.eventSeries.findMany({
    where: { id: { in: seriesIds } },
    include: {
      events: { include: rsvpInclude, orderBy: { date: 'asc' } },
      owner: { select: { email: true } }
    },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * Einzelne Events (Standalone oder Termine), die diesem Nutzer direkt per ResourceAccess
 * geteilt wurden - unabhängig von einer evtl. reihenweiten Freigabe (die läuft über getSharedSeries).
 */
const getSharedEvents = async (userId: string, excludeSeriesIds: string[]) => {
  const access = await prisma.resourceAccess.findMany({ where: { userId, eventId: { not: null } }, select: { eventId: true } })
  const eventIds = access.map(a => a.eventId!).filter(Boolean)
  if (eventIds.length === 0) return []
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    include: { ...rsvpInclude, owner: { select: { email: true } } },
    orderBy: { date: 'asc' }
  })
  return events.filter(e => !e.seriesId || !excludeSeriesIds.includes(e.seriesId))
}

export default async function AdminDashboard() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const isAdmin = user.role === 'ADMIN'
  const isModerator = user.role === 'MODERATOR'

  const [events, series] = await Promise.all([getStandaloneEvents(user.id, isAdmin), getSeries(user.id, isAdmin)])
  const sharedSeries = isAdmin ? [] : await getSharedSeries(user.id)
  const sharedEvents = isAdmin ? [] : await getSharedEvents(user.id, sharedSeries.map(s => s.id))

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">RSVP Admin-Dashboard</h1>
            <p className="text-sm text-gray-500">Eingeloggt als {user.email} <span className="text-gray-400">({ROLE_LABELS[user.role]})</span></p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <PushSubscribeButton vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null} />
            {isAdmin && (
              <Link href="/admin/users" className="bg-gray-100 text-gray-700 px-4 py-2 rounded hover:bg-gray-200 transition text-sm font-medium flex items-center">
                👥 Nutzerverwaltung
              </Link>
            )}
            {!isModerator && (
              <Link href="/admin/create-user" className="bg-gray-100 text-gray-700 px-4 py-2 rounded hover:bg-gray-200 transition text-sm font-medium flex items-center">
                + Nutzer anlegen
              </Link>
            )}
            {!isModerator && (
              <Link href="/admin/series/create" className="bg-purple-100 text-purple-700 px-4 py-2 rounded hover:bg-purple-200 transition text-sm font-medium flex items-center">
                + Neue Reihe
              </Link>
            )}
            {!isModerator && (
              <Link href="/admin/create" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium flex items-center">
                + Neues Event
              </Link>
            )}
            <form action={logoutUser}>
              <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition text-sm font-medium">
                Abmelden
              </button>
            </form>
          </div>
        </div>

        {events.length === 0 && series.length === 0 && sharedSeries.length === 0 && sharedEvents.length === 0 && (
          <p className="text-center text-gray-500 italic bg-white p-6 rounded-lg shadow">
            {isModerator
              ? 'Dir wurde noch kein Event oder keine Reihe freigegeben.'
              : 'Noch keine Events oder Reihen. Leg oben dein erstes Event an.'}
          </p>
        )}

        {events.map(event => (
          <EventRsvpCard
            key={event.id}
            event={event}
            requireVerification={event.requireVerification}
            access="owner"
            ownerEmail={isAdmin && event.owner.email !== user.email ? event.owner.email : undefined}
          />
        ))}

        {series.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-gray-700 border-b border-gray-300 pb-2">
              {isAdmin ? 'Veranstaltungsreihen (alle Konten)' : 'Veranstaltungsreihen'}
            </h2>

            {series.map(s => (
              <div key={s.id} className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-4">
                <div className="flex justify-between items-start bg-white p-4 rounded-lg shadow-sm">
                  <div>
                    <h3 className="text-lg font-bold text-purple-900">{s.title}</h3>
                    <p className="text-sm text-gray-500">Reihen-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/reihe/{s.slug}</span></p>
                    {isAdmin && s.owner.email !== user.email && (
                      <p className="text-xs text-gray-400 mt-1">Eigentümer: {s.owner.email}</p>
                    )}
                    {s.description && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Link href={`/admin/series/${s.id}`} className="px-3 py-1 bg-purple-100 text-purple-700 text-sm font-medium rounded hover:bg-purple-200 transition">
                      ⚙️ Verwalten
                    </Link>
                    <DeleteSeriesButton seriesId={s.id} />
                  </div>
                </div>

                <div className="pl-4 border-l-4 border-purple-200 space-y-6">
                  {s.events.length === 0 ? (
                    <p className="text-sm text-purple-700 italic">Noch keine Termine in dieser Reihe.</p>
                  ) : (
                    s.events.map(event => (
                      <EventRsvpCard key={event.id} event={event} requireVerification={s.requireVerification} access="owner" />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {sharedSeries.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-gray-700 border-b border-gray-300 pb-2">Für dich freigegebene Reihen</h2>

            {sharedSeries.map(s => (
              <div key={s.id} className="bg-teal-50 border border-teal-200 rounded-lg p-4 space-y-4">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h3 className="text-lg font-bold text-teal-900">{s.title}</h3>
                  <p className="text-sm text-gray-500">Reihen-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/reihe/{s.slug}</span></p>
                  <p className="text-xs text-gray-400 mt-1">Eigentümer: {s.owner.email}</p>
                  {s.description && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
                </div>

                <div className="pl-4 border-l-4 border-teal-200 space-y-6">
                  {s.events.length === 0 ? (
                    <p className="text-sm text-teal-700 italic">Noch keine Termine in dieser Reihe.</p>
                  ) : (
                    s.events.map(event => (
                      <EventRsvpCard key={event.id} event={event} requireVerification={s.requireVerification} access="moderator" />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {sharedEvents.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-gray-700 border-b border-gray-300 pb-2">Für dich freigegebene Events</h2>

            {sharedEvents.map(event => (
              <EventRsvpCard
                key={event.id}
                event={event}
                requireVerification={event.requireVerification}
                access="moderator"
                ownerEmail={event.owner.email}
              />
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
