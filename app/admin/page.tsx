// app/admin/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { logoutUser } from './actions'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '../lib/auth'
import EventRsvpCard from './event-rsvp-card'
import DeleteSeriesButton from './delete-series-button'
import PushSubscribeButton from './push-subscribe-button'

const prisma = new PrismaClient()

const getStandaloneEvents = (ownerId: string) => {
  return prisma.event.findMany({
    where: { seriesId: null, ownerId },
    include: {
      rsvps: {
        include: { participant: true },
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { date: 'asc' }
  })
}

const getSeries = (ownerId: string) => {
  return prisma.eventSeries.findMany({
    where: { ownerId },
    include: {
      events: {
        include: {
          rsvps: {
            include: { participant: true },
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { date: 'asc' }
      }
    },
    orderBy: { createdAt: 'asc' }
  })
}

export default async function AdminDashboard() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const [events, series] = await Promise.all([getStandaloneEvents(user.id), getSeries(user.id)])

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">RSVP Admin-Dashboard</h1>
            <p className="text-sm text-gray-500">Eingeloggt als {user.email}</p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <PushSubscribeButton vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null} />
            <Link href="/admin/create-user" className="bg-gray-100 text-gray-700 px-4 py-2 rounded hover:bg-gray-200 transition text-sm font-medium flex items-center">
              + Nutzer anlegen
            </Link>
            <Link href="/admin/series/create" className="bg-purple-100 text-purple-700 px-4 py-2 rounded hover:bg-purple-200 transition text-sm font-medium flex items-center">
              + Neue Reihe
            </Link>
            <Link href="/admin/create" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium flex items-center">
              + Neues Event
            </Link>
            <form action={logoutUser}>
              <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition text-sm font-medium">
                Abmelden
              </button>
            </form>
          </div>
        </div>

        {events.length === 0 && series.length === 0 && (
          <p className="text-center text-gray-500 italic bg-white p-6 rounded-lg shadow">
            Noch keine Events oder Reihen. Leg oben dein erstes Event an.
          </p>
        )}

        {events.map(event => (
          <EventRsvpCard key={event.id} event={event} requireVerification={event.requireVerification} />
        ))}

        {series.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-gray-700 border-b border-gray-300 pb-2">Veranstaltungsreihen</h2>

            {series.map(s => (
              <div key={s.id} className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-4">
                <div className="flex justify-between items-start bg-white p-4 rounded-lg shadow-sm">
                  <div>
                    <h3 className="text-lg font-bold text-purple-900">{s.title}</h3>
                    <p className="text-sm text-gray-500">Reihen-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/reihe/{s.slug}</span></p>
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
                      <EventRsvpCard key={event.id} event={event} requireVerification={s.requireVerification} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
