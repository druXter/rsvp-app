// app/reihe/[seriesSlug]/page.tsx
import { formatEventDate, isArchived } from '../../lib/event-date'
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import PinForm from '../../[slug]/pin-form'
import InvitationGate from '../../[slug]/invitation-gate'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import { invitationCovers } from '../../lib/invitation-store'
import { formatDeadline } from '../../lib/rsvp-deadline'

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

  // Einladungsmodus (docs/KONZEPT-EINLADUNGEN.md): nur mit dem Link einer Einladung der Reihe - dann genau die
  // Termine, zu denen der Haushalt eingeladen ist, mit seinem Stand
  let invitation = null
  if (series.inviteOnly) {
    const participant = token ? await prisma.participant.findUnique({ where: { editToken: token }, select: { id: true } }) : null
    invitation = participant
      ? await prisma.invitation.findFirst({ where: { participantId: participant.id, seriesId: series.id }, include: { events: { select: { eventId: true } }, participant: { include: { rsvps: true } } } })
      : null
    if (!invitation) {
      return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <InvitationGate title={series.title} />
        </main>
      )
    }
  }

  const guestUser = series.inviteOnly ? null : await getCurrentGuestUser()
  // Vergangene Termine (48 h nach Beginn) tauchen hier nicht mehr auf - die Termin-Seite selbst bleibt erreichbar.
  const events = series.events.filter(event => !isArchived(event) && (!invitation || invitationCovers(invitation, event)))

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{series.title}</h1>
          {series.description && <p className="text-gray-600 dark:text-gray-400 mt-2">{series.description}</p>}

          {invitation ? (
            <p className="mt-4 font-semibold text-gray-800 dark:text-gray-200" data-testid="series-invitation">💌 Einladung für {invitation.label} - bitte sagt bei jedem Termin für jede Person zu oder ab.</p>
          ) : guestUser ? (
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
            {events.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 italic">Für diese Reihe stehen aktuell keine Termine an.</p>
            ) : (
              events.map(event => {
                const attendingCount = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).length
                const isFull = event.maxCapacity !== null && attendingCount >= event.maxCapacity
                const formattedDate = formatEventDate(event)
                // Stand des eingeladenen Haushalts zu diesem Termin
                const answer = invitation?.participant.rsvps.find(r => r.eventId === event.id)
                const deadline = formatDeadline(event.rsvpDeadline)

                return (
                  <Link
                    key={event.id}
                    href={`/reihe/${series.slug}/${event.slug}${tokenQuery}`}
                    className="block p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-950"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-gray-100">{event.title}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">📅 {formattedDate}</p>
                        {event.location && <p className="text-sm text-gray-500 dark:text-gray-400">📍 {event.location}</p>}
                      </div>
                      {invitation && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${!answer ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : answer.isAttending ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`} data-testid="termin-answer">
                          {!answer ? (deadline ? `bitte antworten bis ${deadline}` : 'noch offen') : answer.isAttending ? (answer.isOnWaitlist ? 'Warteliste' : 'zugesagt') : 'abgesagt'}
                        </span>
                      )}
                      {!invitation && event.maxCapacity !== null && (
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
