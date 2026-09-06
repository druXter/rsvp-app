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
    include: { rsvps: { include: { participant: true } }, series: true }
  })

  if (!event) return new NextResponse("Event nicht gefunden", { status: 404 })

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

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
    const participant = rsvp.participant

    // Verifizierungs-Status berechnen
    let verificationStatus = "";
    if (participant.email) {
      if (requireVerification && !participant.isVerified) verificationStatus = "Ausstehend";
      else if (participant.isVerified) verificationStatus = "Verifiziert";
      else verificationStatus = "Ohne Prüfung";
    }

    rows.push([
      participant.name,
      rsvp.isAttending ? "Kommt" : "Abgesagt",
      participant.email || "",
      verificationStatus, // <-- NEU
      participant.phone || "",

      rsvp.plusOne ? "Ja" : "Nein",
      rsvp.plusOneName || "",

      participant.dietaryOption || "",
      participant.allergies || "",

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