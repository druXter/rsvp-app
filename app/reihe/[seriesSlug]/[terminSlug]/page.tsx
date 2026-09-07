// app/reihe/[seriesSlug]/[terminSlug]/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import RsvpForm from '../../../[slug]/rsvp-form'
import PinForm from '../../../[slug]/pin-form'
import { getCurrentGuestUser } from '../../../lib/guest-auth'

const prisma = new PrismaClient()

export default async function SeriesEventPage({
  params,
  searchParams
}: {
  params: Promise<{ seriesSlug: string; terminSlug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { seriesSlug, terminSlug } = await params
  const currentSearchParams = await searchParams

  const series = await prisma.eventSeries.findUnique({ where: { slug: seriesSlug } })
  if (!series) notFound()

  const event = await prisma.event.findFirst({ where: { slug: terminSlug, seriesId: series.id } })
  if (!event) notFound()

  // Zugangsprüfung über die reihenweite PIN (gilt für alle Termine der Reihe)
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
      <main className="min-h-screen bg-gray-50">
        <PinForm seriesId={series.id} slug={series.slug} title={series.title} />
      </main>
    )
  }

  // Participant + dessen Antwort zu GENAU DIESEM Termin laden
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
  } else {
    // Ohne Token: eingeloggten Gast (Nutzer-Konto, siehe #12) über die Session auflösen -
    // so kann ein eingeloggter Nutzer ohne Link direkt aus "Mein Konto" antworten.
    const guestUser = await getCurrentGuestUser()
    if (guestUser) {
      const guestParticipant = await prisma.participant.findFirst({ where: { seriesId: series.id, guestUserId: guestUser.id } })
      if (guestParticipant) {
        participant = guestParticipant
        existingRsvp = await prisma.rsvp.findUnique({
          where: { eventId_participantId: { eventId: event.id, participantId: guestParticipant.id } }
        })
      } else {
        // Erster Termin dieser Reihe für diesen Nutzer - Formular aus dem zentralen Profil vorausfüllen
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
  }

  // Reihenweite Profil-Felder (E-Mail/Handy/Essen/Allergien) mit den pro Termin
  // abgefragten Feldern (Alkohol/Begleitung/Mitbringsel) zu EINER Konfiguration mergen
  const perTerminConfig = event.formConfig ? JSON.parse(event.formConfig) : {}
  const mergedConfig = JSON.stringify({
    ...perTerminConfig,
    askEmail: series.askEmail,
    askPhone: series.askPhone,
    askDiet: series.askDiet,
    askAllergies: series.askAllergies,
  })

  // Öffentliche Gästeliste - EXTREM WICHTIG: Nur ungefährliche Felder abfragen!
  let publicRsvps: any[] = []
  if (series.isGuestListVisible) {
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
    <main className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <Link href={`/reihe/${series.slug}${token ? `?token=${token}` : ''}`} className="inline-block text-sm text-blue-600 hover:underline">
          ← Alle Termine von {series.title}
        </Link>

        <RsvpForm
          eventId={event.id}
          formConfig={mergedConfig}
          participant={participant}
          rsvp={existingRsvp}
          isGuestListVisible={series.isGuestListVisible}
          isSeriesShared={true}
        />

        {series.isGuestListVisible && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold mb-4 text-gray-800">Gästeliste</h3>

            {publicRsvps.length === 0 ? (
              <p className="text-gray-500 italic">Noch keine Rückmeldungen vorhanden.</p>
            ) : (
              <ul className="space-y-3">
                {publicRsvps.map((guest) => (
                  <li key={guest.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 rounded border border-gray-100">
                    <div>
                      <span className="font-bold text-gray-800">{guest.participant.name}</span>
                      {guest.plusOne && guest.plusOneName && (
                        <span className="text-gray-500 text-sm ml-1">(+ {guest.plusOneName})</span>
                      )}

                      {guest.isAttending && guest.bringingItem && (
                        <div className="text-sm text-blue-600 mt-1">
                          🍕 Bringt mit: {guest.bringingItem}
                        </div>
                      )}

                      {!guest.isAttending && guest.declineReason && (
                        <div className="text-sm text-gray-500 mt-1 italic">
                          "{guest.declineReason}"
                        </div>
                      )}
                    </div>

                    <div className="mt-2 sm:mt-0">
                      {guest.isAttending ? (
                        guest.isOnWaitlist ? (
                          <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded-full font-bold">Warteliste</span>
                        ) : (
                          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-bold">Dabei</span>
                        )
                      ) : (
                        <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full font-bold">Abgesagt</span>
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
