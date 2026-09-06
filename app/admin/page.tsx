// app/admin/page.tsx
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { logoutAdmin } from './actions'
import { redirect } from 'next/navigation'
import EventRsvpCard from './event-rsvp-card'
import DeleteSeriesButton from './delete-series-button'

const prisma = new PrismaClient()

const getStandaloneEvents = () => {
  return prisma.event.findMany({
    where: { seriesId: null },
    include: {
      rsvps: {
        include: { participant: true },
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { date: 'asc' }
  })
}

const getSeries = () => {
  return prisma.eventSeries.findMany({
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
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')

  if (!session || session.value !== 'true') {
    redirect('/admin/login')
  }

  const [events, series] = await Promise.all([getStandaloneEvents(), getSeries()])

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow">
          <h1 className="text-2xl font-bold text-gray-900">RSVP Admin-Dashboard</h1>
          <div className="flex gap-4">
            <Link href="/admin/series/create" className="bg-purple-100 text-purple-700 px-4 py-2 rounded hover:bg-purple-200 transition text-sm font-medium flex items-center">
              + Neue Reihe
            </Link>
            <Link href="/admin/create" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium flex items-center">
              + Neues Event
            </Link>
            <form action={logoutAdmin}>
              <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition text-sm font-medium">
                Abmelden
              </button>
            </form>
          </div>
        </div>

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
