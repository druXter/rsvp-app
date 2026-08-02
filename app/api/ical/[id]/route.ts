// app/api/ical/[id]/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { createEvent, DateArray } from 'ics'

const prisma = new PrismaClient()

/**
 * API-Route zur dynamischen Generierung einer Kalender-Datei (.ics).
 * Erlaubt es Gästen, das Event direkt in ihren Apple/Google/Outlook-Kalender zu importieren.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  // Das Event anhand der ID aus der Datenbank holen
  const event = await prisma.event.findUnique({ where: { id } })

  if (!event) {
    return new NextResponse('Event nicht gefunden', { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  // FIX: Wir nutzen die feste URL aus der .env-Datei (falls vorhanden), 
  // ansonsten fallen wir auf die Request-URL zurück (für lokale Entwicklung)
  const baseUrl = process.env.BASE_URL || new URL(request.url).origin

  // Persönlichen Bearbeitungslink generieren und an die Event-Beschreibung anhängen
  const personalLink = token ? `\n\nAntwort nachträglich bearbeiten: ${baseUrl}/${event.slug}?token=${token}` : ''
  const fullDescription = (event.description || '') + personalLink

  const date = new Date(event.date)
  
  // Datum für das ics-Paket als numerisches Array aufbereiten
  const eventDate: DateArray = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1, 
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes()
  ]

  // Kalender-Datei über die 'ics' Bibliothek generieren
  const { error, value } = createEvent({
    title: event.title,
    description: fullDescription, 
    location: event.location || '',
    start: eventDate,
    duration: { hours: event.duration }, 
    
    startInputType: 'utc',
    startOutputType: 'utc'
  })

  // Fehlerbehandlung falls die Generierung fehlschlägt
  if (error || !value) {
    return new NextResponse('Fehler beim Erstellen der Kalender-Datei', { status: 500 })
  }

  // Den generierten Text als herunterladbare .ics Datei ausliefern
  return new NextResponse(value, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${event.slug}.ics"`,
    },
  })
}