// app/api/export/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'

const prisma = new PrismaClient()

/**
 * API-Route zum Exportieren einer Gästeliste als CSV-Datei.
 * Wird über /api/export?eventId=[ID] aufgerufen.
 */
export async function GET(request: Request) {
  // Event-ID aus den URL-Parametern auslesen
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return new NextResponse("Fehlende Event-ID", { status: 400 })

  // Event inklusive aller zugehörigen Antworten (RSVPs) abrufen
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true } 
  })

  if (!event) return new NextResponse("Event nicht gefunden", { status: 404 })

  // CSV-Kopfzeile definieren
  const rows = [
    [
      "Name", 
      "Status", 
      "E-Mail", 
      "Handy", 
      "Begleitung", 
      "Name der Begleitung", 
      "Essen", 
      "Allergien", 
      "Alkohol", 
      "Mitbringsel", 
      "Anmerkungen / Grund", 
      "Datum"
    ]
  ]

  // Für jeden Gast eine Zeile mit den entsprechenden Daten hinzufügen
  event.rsvps.forEach(rsvp => {
    rows.push([
      rsvp.name,
      rsvp.isAttending ? "Kommt" : "Abgesagt",
      rsvp.email || "",
      rsvp.phone || "",
      
      rsvp.plusOne ? "Ja" : "Nein",
      rsvp.plusOneName || "",
      
      rsvp.dietaryOption || "",
      rsvp.allergies || "",
      
      rsvp.drinksAlcohol === true ? "Ja" : rsvp.drinksAlcohol === false ? "Nein" : "",
      rsvp.bringingItem || "",
      
      rsvp.isAttending ? (rsvp.additionalInfo || "") : (rsvp.declineReason || ""),
      
      // Datum sauber als YYYY-MM-DD formatieren
      rsvp.createdAt.toISOString().split('T')[0]
      
      // Alle Felder in Anführungszeichen setzen, um Konflikte mit Kommas oder Semikolons in den Texten zu vermeiden
    ].map(field => `"${String(field).replace(/"/g, '""')}"`))
  })

  // CSV zusammenbauen. \uFEFF (Byte Order Mark) signalisiert Programmen wie Excel, dass es sich um UTF-8 handelt (wichtig für Umlaute).
  const csvContent = "\uFEFF" + rows.map(e => e.join(";")).join("\n")

  // Datei als Download an den Browser senden
  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gaesteliste-${event.slug}.csv"`,
    }
  })
}