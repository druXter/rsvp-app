// app/api/export/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'

const prisma = new PrismaClient()

/**
 * API-Route zum Exportieren einer Gästeliste als CSV-Datei.
 * Wird über /api/export?eventId=[ID] aufgerufen.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return new NextResponse("Fehlende Event-ID", { status: 400 })

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true } 
  })

  if (!event) return new NextResponse("Event nicht gefunden", { status: 404 })

  // CSV-Kopfzeile definieren (NEU: Spalte 'Verifizierung' hinzugefügt)
  const rows = [
    [
      "Name", 
      "Status", 
      "E-Mail",
      "Verifizierung", // <-- NEU
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

  event.rsvps.forEach(rsvp => {
    // Verifizierungs-Status berechnen
    let verificationStatus = "";
    if (rsvp.email) {
      if (event.requireVerification && !rsvp.isVerified) verificationStatus = "Ausstehend";
      else if (rsvp.isVerified) verificationStatus = "Verifiziert";
      else verificationStatus = "Ohne Prüfung";
    }

    rows.push([
      rsvp.name,
      rsvp.isAttending ? "Kommt" : "Abgesagt",
      rsvp.email || "",
      verificationStatus, // <-- NEU
      rsvp.phone || "",
      
      rsvp.plusOne ? "Ja" : "Nein",
      rsvp.plusOneName || "",
      
      rsvp.dietaryOption || "",
      rsvp.allergies || "",
      
      rsvp.drinksAlcohol === true ? "Ja" : rsvp.drinksAlcohol === false ? "Nein" : "",
      rsvp.bringingItem || "",
      
      rsvp.isAttending ? (rsvp.additionalInfo || "") : (rsvp.declineReason || ""),
      
      rsvp.createdAt.toISOString().split('T')[0]
      
    ].map(field => `"${String(field).replace(/"/g, '""')}"`))
  })

  const csvContent = "\uFEFF" + rows.map(e => e.join(";")).join("\n")

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gaesteliste-${event.slug}.csv"`,
    }
  })
}