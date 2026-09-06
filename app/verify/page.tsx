// app/verify/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { sendWaitlistEmail, sendConfirmationEmail } from '../lib/mail'

const prisma = new PrismaClient()

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  if (!token) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Fehler</h1>
          <p className="text-gray-700">Es wurde kein Verifizierungs-Token übergeben.</p>
        </div>
      </main>
    )
  }

  // Participant anhand des Tokens suchen. Die Verifizierung gilt für die Person,
  // nicht mehr für eine einzelne Antwort - sie kann daher mehrere ausstehende
  // Termin-Antworten (innerhalb einer Reihe) auf einmal bestätigen.
  const participant = await prisma.participant.findUnique({
    where: { verifyToken: token }
  })

  if (!participant) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Ungültiger Link</h1>
          <p className="text-gray-700">Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.</p>
        </div>
      </main>
    )
  }

  const verifiedParticipant = await prisma.participant.update({
    where: { id: participant.id },
    data: { isVerified: true, verifiedAt: new Date(), verifyToken: null }
  })

  // Alle Zusagen dieser Person, die auf die Verifizierung gewartet haben
  const pendingRsvps = await prisma.rsvp.findMany({
    where: { participantId: participant.id, isAttending: true },
    include: { event: { include: { series: true } } }
  })

  const results: { title: string; slug: string; seriesSlug: string | null; isOnWaitlist: boolean }[] = []

  for (const rsvp of pendingRsvps) {
    let finalIsOnWaitlist = rsvp.isOnWaitlist

    if (rsvp.isOnWaitlist && rsvp.event.maxCapacity !== null) {
      const currentAttendeesCount = await prisma.rsvp.count({
        where: { eventId: rsvp.eventId, isAttending: true, isOnWaitlist: false }
      })
      if (currentAttendeesCount < rsvp.event.maxCapacity) {
        finalIsOnWaitlist = false
      }
    }

    const updatedRsvp = await prisma.rsvp.update({
      where: { id: rsvp.id },
      data: { isOnWaitlist: finalIsOnWaitlist }
    })

    try {
      if (updatedRsvp.isOnWaitlist) {
        await sendWaitlistEmail(verifiedParticipant, updatedRsvp, rsvp.event)
      } else {
        await sendConfirmationEmail(verifiedParticipant, updatedRsvp, rsvp.event)
      }
    } catch (error) {
      console.error("Fehler beim Senden der Bestätigung nach Verifizierung:", error)
    }

    results.push({
      title: rsvp.event.title,
      slug: rsvp.event.slug,
      seriesSlug: rsvp.event.series?.slug ?? null,
      isOnWaitlist: updatedRsvp.isOnWaitlist
    })
  }

  const linkFor = (r: (typeof results)[number]) =>
    r.seriesSlug
      ? `/reihe/${r.seriesSlug}/${r.slug}?token=${verifiedParticipant.editToken}`
      : `/${r.slug}?token=${verifiedParticipant.editToken}`

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
        <h1 className="text-2xl font-bold text-green-600 mb-4">Erfolgreich bestätigt! 🎉</h1>
        <p className="text-gray-700 mb-6">
          Deine E-Mail-Adresse wurde verifiziert{results.length === 1 && (
            <> und deine Anmeldung für <strong>{results[0].title}</strong> ist nun gültig</>
          )}.
        </p>

        {results.length > 1 && (
          <div className="text-left mb-6 space-y-2">
            {results.map(r => (
              <div key={r.slug} className={`text-sm p-3 rounded ${r.isOnWaitlist ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-700'}`}>
                <strong>{r.title}</strong>: {r.isOnWaitlist ? 'Warteliste' : 'Bestätigt'}
              </div>
            ))}
          </div>
        )}

        {results.length === 1 && results[0].isOnWaitlist && (
          <p className="text-sm text-orange-600 font-bold mb-6 bg-orange-50 p-3 rounded">
            Du stehst aktuell auf der Warteliste. Wir haben dir dazu eine E-Mail gesendet.
          </p>
        )}
        {results.length === 1 && !results[0].isOnWaitlist && (
          <p className="text-sm text-gray-500 mb-6">
            Wir haben dir soeben die finale Bestätigung inkl. Kalendereintrag per E-Mail gesendet.
          </p>
        )}

        {results.length >= 1 && (
          <Link href={linkFor(results[0])} className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
            Zurück zu deiner Anmeldung
          </Link>
        )}
      </div>
    </main>
  )
}
