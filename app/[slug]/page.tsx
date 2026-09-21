import { Prisma, PrismaClient } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import RsvpForm from './rsvp-form'
import PinForm from './pin-form'
import GuestRequiredGate from './guest-required-gate'
import PollResultBanner from '../ui/poll-result-banner'
import { getCurrentGuestUser } from '../lib/guest-auth'

const prisma = new PrismaClient()

type PublicRsvp = Prisma.RsvpGetPayload<{
  select: {
    id: true
    isAttending: true
    isOnWaitlist: true
    plusOne: true
    plusOneName: true
    bringingItem: true
    declineReason: true
    createdAt: true
    participant: { select: { name: true } }
  }
}>

export default async function EventPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // FIX: In Next.js 15+ müssen params und searchParams asynchron aufgelöst werden!
  const { slug } = await params;
  const currentSearchParams = await searchParams;

  const event = await prisma.event.findUnique({
    where: { slug: slug },
    include: { series: true }
  })

  if (!event) notFound()

  // Termine einer Reihe werden ausschließlich über die Reihen-Route bedient,
  // damit reihenweite PIN/Gästeliste/Profil-Einstellungen konsistent greifen.
  if (event.series) {
    const token = typeof currentSearchParams?.token === 'string' ? `?token=${currentSearchParams.token}` : ''
    redirect(`/reihe/${event.series.slug}/${event.slug}${token}`)
  }

  // 1. Zugangsprüfung (Issue #9)
  let isAuthorized = true;
  if (event.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`event_pin_${event.id}`)

    if (pinCookie?.value !== event.eventPin) {
      isAuthorized = false;
    }
  }

  // Wenn nicht berechtigt, zeige nur das PIN-Formular
  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <PinForm eventId={event.id} slug={event.slug} title={event.title} />
      </main>
    )
  }

  // 2. Token aus der URL auslesen und bestehenden Participant + dessen Antwort zu diesem Termin laden
  const token = typeof currentSearchParams?.token === 'string' ? currentSearchParams.token : undefined
  let participant = null
  let existingRsvp = null

  if (token) {
    participant = await prisma.participant.findUnique({ where: { editToken: token } })
    if (participant) {
      existingRsvp = await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId: event.id, participantId: participant.id } }
      })
    }
  } else if (event.requireGuestUser) {
    // "Nur registrierte Teilnehmer": ohne editToken MUSS eine eingeloggte Gast-Session
    // vorliegen, sonst wird statt des Formulars nur das Login/Registrieren-Gate gezeigt
    // (siehe performRsvpSubmission für die serverseitige Absicherung derselben Regel).
    const guestUser = await getCurrentGuestUser()
    if (!guestUser) {
      const nextPath = `/${event.slug}`
      return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <GuestRequiredGate
            title={event.title}
            loginHref={`/mein-konto/login?next=${encodeURIComponent(nextPath)}`}
            registerHref={`/${event.slug}/registrieren?next=${encodeURIComponent(nextPath)}`}
          />
        </main>
      )
    }

    const guestParticipant = await prisma.participant.findFirst({
      where: { guestUserId: guestUser.id, rsvps: { some: { eventId: event.id } } }
    })
    if (guestParticipant) {
      participant = guestParticipant
      existingRsvp = await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId: event.id, participantId: guestParticipant.id } }
      })
    } else {
      // Erste Antwort dieses Kontos zu diesem Event - Formular aus dem zentralen Profil vorausfüllen
      participant = {
        name: guestUser.name,
        email: guestUser.email,
        phone: guestUser.phone,
        dietaryOption: guestUser.dietaryOption,
        allergies: guestUser.allergies,
        isVerified: guestUser.isVerified,
        editToken: undefined
      }
    }
  }

  // 3. Gästeliste laden (Issue #8) - EXTREM WICHTIG: Nur ungefährliche Felder abfragen!
  let publicRsvps: PublicRsvp[] = [];
  if (event.isGuestListVisible) {
    publicRsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        isAttending: true,
        isOnWaitlist: true,
        plusOne: true,
        plusOneName: true,
        bringingItem: true,
        declineReason: true,
        createdAt: true,
        participant: { select: { name: true } }
        // E-MAIL, HANDYNUMMER, ALLERGIEN SIND HIER ABSICHTLICH NICHT DABEI!
      },
      orderBy: { createdAt: 'asc' }
    })
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4">

        <PollResultBanner pollResult={event.pollResult} />

        {event.pollUrl && (
          <a
            href={`/api/poll-link/${event.id}`}
            className="block mb-4 text-center bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-3 px-4 font-medium hover:bg-cyan-100 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800 dark:hover:bg-cyan-900 transition"
          >
            {event.pollLabel || '🗳️ Zur Abstimmung'}
          </a>
        )}

        {/* Das eigentliche Formular */}
        <RsvpForm
          eventId={event.id}
          formConfig={event.formConfig}
          participant={participant}
          rsvp={existingRsvp}
          isGuestListVisible={event.isGuestListVisible}
          usedUrlToken={!!token}
          vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null}
        />

        {/* Die öffentliche Gästeliste */}
        {event.isGuestListVisible && (
          <div className="mt-12 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">Gästeliste</h3>

            {publicRsvps.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 italic">Noch keine Rückmeldungen vorhanden.</p>
            ) : (
              <ul className="space-y-3">
                {publicRsvps.map((guest) => (
                  <li key={guest.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-100 dark:border-gray-700">
                    <div>
                      <span className="font-bold text-gray-800 dark:text-gray-100">{guest.participant.name}</span>
                      {guest.plusOne && guest.plusOneName && (
                        <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">(+ {guest.plusOneName})</span>
                      )}

                      {/* Mitbringsel anzeigen, falls Zusage */}
                      {guest.isAttending && guest.bringingItem && (
                        <div className="text-sm text-blue-600 mt-1">
                          🍕 Bringt mit: {guest.bringingItem}
                        </div>
                      )}

                      {/* Absagegrund anzeigen, falls Absage */}
                      {!guest.isAttending && guest.declineReason && (
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 italic">
                          &quot;{guest.declineReason}&quot;
                        </div>
                      )}
                    </div>

                    <div className="mt-2 sm:mt-0">
                      {guest.isAttending ? (
                        guest.isOnWaitlist ? (
                          <span className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs px-2 py-1 rounded-full font-bold">Warteliste</span>
                        ) : (
                          <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs px-2 py-1 rounded-full font-bold">Dabei</span>
                        )
                      ) : (
                        <span className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs px-2 py-1 rounded-full font-bold">Abgesagt</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </main>
  )
}
