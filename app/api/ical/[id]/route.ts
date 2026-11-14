// app/api/ical/[id]/route.ts
import { prisma } from '../../../lib/prisma'
import { NextResponse } from 'next/server'
import { buildEventIcs, ICS_CONTENT_TYPE } from '../../../lib/ics'
import { hasEventPinAccess, tokenBelongsToEvent } from '../../../lib/pin'
import { personalEventLink } from '../../../lib/mail'


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
  const event = await prisma.event.findUnique({ where: { id }, include: { series: true } })

  if (!event) {
    return new NextResponse('Event nicht gefunden', { status: 404 })
  }
  // "Datum noch offen" (Event.datePending): noch kein Termin, den man eintragen könnte.
  if (event.datePending) {
    return new NextResponse('Das Datum dieses Events wird noch abgestimmt.', { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  // Titel, Ort, Beschreibung und Datum eines PIN-geschützten Events gehören zu dem, was die PIN schützt.
  // Die Event-ID steht als verstecktes Feld sogar im PIN-Formular. Erlaubt ist die Datei mit PIN-Cookie
  // ODER mit dem gültigen persönlichen Token dieses Termins (Link aus der Bestätigungs-Mail).
  const ownToken = await tokenBelongsToEvent(token, event)
  if (!(await hasEventPinAccess(event)) && !ownToken) {
    return new NextResponse('Für dieses Event ist ein Zugangscode erforderlich.', { status: 403 })
  }

  // FIX: Wir nutzen die feste URL aus der .env-Datei (falls vorhanden), 
  // ansonsten fallen wir auf die Request-URL zurück (für lokale Entwicklung)
  const baseUrl = process.env.BASE_URL || new URL(request.url).origin

  // Persönlichen Bearbeitungslink an die Beschreibung anhängen - nur einen echten Link zu diesem Termin. Sonst
  // lieferte /api/ical/<id>?token=<Text> eine echte Kalenderdatei von unserer Adresse mit fremdem Text darin
  // (docs/AUDIT-2026-11.md, R-10).
  const personalLink = ownToken ? `\n\nAntwort nachträglich bearbeiten: ${personalEventLink(event, { editToken: token! })}` : ''
  const fullDescription = (event.description || '') + personalLink

  const value = buildEventIcs(event, fullDescription, baseUrl)
  if (!value) {
    return new NextResponse('Fehler beim Erstellen der Kalender-Datei', { status: 500 })
  }

  // Den generierten Text als herunterladbare .ics Datei ausliefern
  return new NextResponse(value, {
    headers: {
      'Content-Type': ICS_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${event.slug}.ics"`,
    },
  })
}