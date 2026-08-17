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

  // RSVP anhand des Tokens suchen
  const rsvp = await prisma.rsvp.findUnique({
    where: { verifyToken: token },
    include: { event: true } // Das zugehörige Event direkt mitladen
  })

  if (!rsvp) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Ungültiger Link</h1>
          <p className="text-gray-700">Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.</p>
        </div>
      </main>
    )
  }

  let finalIsOnWaitlist = rsvp.isOnWaitlist;
  
  if (rsvp.isOnWaitlist && rsvp.event.maxCapacity !== null) {
    // Aktuell belegte Plätze zählen
    const currentAttendeesCount = await prisma.rsvp.count({
      where: {
        eventId: rsvp.eventId,
        isAttending: true,
        isOnWaitlist: false,
      }
    });
    
    // Wenn Platz ist, lassen wir ihn gar nicht erst auf die Warteliste
    if (currentAttendeesCount < rsvp.event.maxCapacity) {
      finalIsOnWaitlist = false;
    }
  }

  // RSVP als verifiziert markieren und Wartelisten-Status ggf. direkt anpassen
  const updatedRsvp = await prisma.rsvp.update({
    where: { id: rsvp.id },
    data: {
      isVerified: true,
      verifiedAt: new Date(),
      verifyToken: null,
      isOnWaitlist: finalIsOnWaitlist // <-- Nimmt den neuen Wert
    }
  })

  // E-Mails senden
  try {
    if (updatedRsvp.isOnWaitlist) {
      await sendWaitlistEmail(updatedRsvp, rsvp.event)
    } else {
      await sendConfirmationEmail(updatedRsvp, rsvp.event)
    }
  } catch (error) {
    console.error("Fehler beim Senden der Bestätigung nach Verifizierung:", error)
  }

  const eventLink = `/${rsvp.event.slug}?token=${updatedRsvp.editToken}`

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
        <h1 className="text-2xl font-bold text-green-600 mb-4">Erfolgreich bestätigt! 🎉</h1>
        <p className="text-gray-700 mb-6">
          Deine E-Mail-Adresse wurde verifiziert und deine Anmeldung für <strong>{rsvp.event.title}</strong> ist nun gültig.
        </p>
        {/* Wir geben auch hier visuelles Feedback, falls es nur für die Warteliste gereicht hat */}
        {updatedRsvp.isOnWaitlist ? (
          <p className="text-sm text-orange-600 font-bold mb-6 bg-orange-50 p-3 rounded">
            Du stehst aktuell auf der Warteliste. Wir haben dir dazu eine E-Mail gesendet.
          </p>
        ) : (
          <p className="text-sm text-gray-500 mb-6">
            Wir haben dir soeben die finale Bestätigung inkl. Kalendereintrag per E-Mail gesendet.
          </p>
        )}
        <Link href={eventLink} className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zurück zu deiner Anmeldung
        </Link>
      </div>
    </main>
  )
}