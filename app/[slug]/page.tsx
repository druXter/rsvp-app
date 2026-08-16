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
  searchParams: Promise<{ token?: string, embed?: string }> // NEU: embed-Parameter hinzugefügt
}) {
  const { slug } = await params;
  const { token, embed } = await searchParams; // NEU: embed auslesen
  
  // Prüfen, ob die Seite als iFrame geladen werden soll (?embed=true)
  const isEmbed = embed === 'true';

  // Event-Daten aus der Datenbank abrufen
  const event = await prisma.event.findUnique({
    where: { slug }
  })

// 404-Fehlerseite anzeigen, falls das Event (der Slug) nicht existiert
  if (!event) {
    notFound()
    return null // <-- NEU: Das beruhigt TypeScript, falls notFound() nicht als Abbruch erkannt wird
  }

  // Prüfen, ob der Gast über einen personalisierten Link (Token) auf die Seite zugreift.
  let existingRsvp = null;
  if (token) {
    existingRsvp = await prisma.rsvp.findUnique({
      where: { editToken: token }
    })
  }

  return (
    <>
      {/* NEU: Zwingt den HTML-Body des iFrames auf komplett transparent */}
      {isEmbed && (
        <style>{`
          body {
            background-color: transparent !important;
          }
        `}</style>
      )}

      {/* Dynamischer Hintergrund: Transparent ohne Padding beim Embed, sonst Standard-Design */}
      <main className={isEmbed ? "bg-transparent py-4 px-2" : "min-h-screen bg-gray-100 py-12 px-4"}>
        <div className="max-w-2xl mx-auto space-y-8">
          
          {/* Dynamische Box: Kein weißer Kasten und Schatten beim Embed */}
          <div className={isEmbed ? "text-center" : "bg-white p-8 rounded-lg shadow text-center"}>
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
            isEmbed={isEmbed}
          />
          
        </div>
      </main>
    </>
  )
}