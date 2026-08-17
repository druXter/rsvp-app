// app/verify/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { sendConfirmationEmail } from '../lib/mail'

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

  // RSVP als verifiziert markieren, Zeitstempel setzen und Token löschen
  const updatedRsvp = await prisma.rsvp.update({
    where: { id: rsvp.id },
    data: {
      isVerified: true,
      verifiedAt: new Date(),
      verifyToken: null
    }
  })

  // Jetzt die finale, normale Bestätigungs-E-Mail (inkl. Kalender-Eintrag) senden
  try {
    await sendConfirmationEmail(updatedRsvp, rsvp.event)
  } catch (error) {
    console.error("Fehler beim Senden der Bestätigung nach Verifizierung:", error)
  }

  const eventLink = `/${rsvp.event.slug}?token=${updatedRsvp.editToken}`

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
        <h1 className="text-2xl font-bold text-green-600 mb-4">Erfolgreich bestätigt! 🎉</h1>
        <p className="text-gray-700 mb-6">
          Deine E-Mail-Adresse wurde verifiziert und deine Anmeldung für <strong>{rsvp.event.title}</strong> ist nun verbindlich.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Wir haben dir soeben die finale Bestätigung inkl. Kalendereintrag per E-Mail gesendet.
        </p>
        <Link href={eventLink} className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zurück zu deiner Anmeldung
        </Link>
      </div>
    </main>
  )
}