// app/reihe/[seriesSlug]/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import PinForm from '../../[slug]/pin-form'
import { getCurrentGuestUser } from '../../lib/guest-auth'

const prisma = new PrismaClient()

export default async function SeriesOverviewPage({
  params,
  searchParams
}: {
  params: Promise<{ seriesSlug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { seriesSlug } = await params
  const currentSearchParams = await searchParams

  const series = await prisma.eventSeries.findUnique({
    where: { slug: seriesSlug },
    include: { events: { include: { rsvps: true }, orderBy: { date: 'asc' } } }
  })

  if (!series) notFound()

  // Zugangsprüfung über die reihenweite PIN
  let isAuthorized = true
  if (series.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`series_pin_${series.id}`)
    if (pinCookie?.value !== series.eventPin) {
      isAuthorized = false
    }
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <PinForm seriesId={series.id} slug={series.slug} title={series.title} />
      </main>
    )
  }

  const token = typeof currentSearchParams?.token === 'string' ? currentSearchParams.token : undefined
  const tokenQuery = token ? `?token=${token}` : ''
  const guestUser = await getCurrentGuestUser()

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{series.title}</h1>
          {series.description && <p className="text-gray-600 dark:text-gray-400 mt-2">{series.description}</p>}

          {guestUser ? (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Eingeloggt als {guestUser.email} - <Link href="/mein-konto" className="text-blue-600 hover:underline font-medium">Zu deinem Konto</Link>
            </p>
          ) : (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              <Link href={`/reihe/${series.slug}/registrieren`} className="text-blue-600 hover:underline font-medium">Konto erstellen</Link>
              {' '}um dich künftig automatisch einzuloggen, statt dir einen Link zu merken. Bereits ein Konto?{' '}
              <Link href="/mein-konto/login" className="text-blue-600 hover:underline font-medium">Einloggen</Link>.
            </p>
          )}

          <div className="mt-6 space-y-3">
            {series.events.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 italic">Für diese Reihe stehen aktuell noch keine Termine fest.</p>
            ) : (
              series.events.map(event => {
                const attendingCount = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).length
                const isFull = event.maxCapacity !== null && attendingCount >= event.maxCapacity
                const formattedDate = new Date(event.date).toLocaleString('de-DE', {
                  timeZone: 'Europe/Berlin',
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })

                return (
                  <Link
                    key={event.id}
                    href={`/reihe/${series.slug}/${event.slug}${tokenQuery}`}
                    className="block p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-950"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-gray-100">{event.title}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">📅 {formattedDate} Uhr</p>
                        {event.location && <p className="text-sm text-gray-500 dark:text-gray-400">📍 {event.location}</p>}
                      </div>
                      {event.maxCapacity !== null && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${isFull ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                          {isFull ? 'Warteliste' : `${attendingCount}/${event.maxCapacity} Plätzen`}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
