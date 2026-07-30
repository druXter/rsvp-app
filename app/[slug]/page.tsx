// app/[slug]/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import RsvpForm from './rsvp-form'

const prisma = new PrismaClient()

/**
 * Hauptseite für ein spezifisches Event.
 * Wird dynamisch anhand des URL-Slugs generiert (z.B. /sommerfest-2024).
 */
export default async function EventPage({ 
  params,
  searchParams
}: { 
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ token?: string }> 
}) {
  // In neueren Next.js Versionen werden params und searchParams als Promises übergeben
  const { slug } = await params;
  const { token } = await searchParams;
  
  // Event-Daten aus der Datenbank abrufen
  const event = await prisma.event.findUnique({
    where: { slug }
  })

  // 404-Fehlerseite anzeigen, falls das Event (der Slug) nicht existiert
  if (!event) {
    notFound()
  }

  // Prüfen, ob der Gast über einen personalisierten Link (Token) auf die Seite zugreift.
  // Wenn ja, laden wir seine bisherigen Antworten, damit das Formular vorausgefüllt werden kann.
  let existingRsvp = null;
  if (token) {
    existingRsvp = await prisma.rsvp.findUnique({
      where: { editToken: token }
    })
  }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        
        {/* Event-Details (Titel, Beschreibung, Datum, Ort) */}
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <h1 className="text-3xl font-bold mb-4">{event.title}</h1>
          <p className="text-gray-600 whitespace-pre-wrap">{event.description}</p>
          
          <div className="mt-6 flex justify-center gap-8 text-sm text-gray-500">
            <div suppressHydrationWarning>
              📅 {event.date.toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin', 
                weekday: 'short', 
                day: '2-digit', 
                month: 'long', 
                year: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit', 
                timeZoneName: 'short'
              })}
            </div>
            {event.location && <div>📍 {event.location}</div>}
          </div>
        </div>

        {/* Interaktives Gäste-Formular laden und Konfiguration übergeben */}
        <RsvpForm 
          eventId={event.id} 
          formConfig={event.formConfig} 
          existingRsvp={existingRsvp} 
        />
        
      </div>
    </main>
  )
}