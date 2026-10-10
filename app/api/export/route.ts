// app/api/export/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../lib/auth'
import { hasEventModeratorOrAbove } from '../../lib/permissions'
import { claimedLabels } from '../../lib/bring-list'
import { PAYMENT_STATE_LABEL, paymentState } from '../../lib/payment-state'

const prisma = new PrismaClient()

/**
 * API-Route zum Exportieren einer Gästeliste als CSV-Datei.
 * Wird über /api/export?eventId=[ID] aufgerufen. Für den Owner, einen Admin oder
 * einen Nutzer mit geteiltem Moderator-Zugriff auf dieses Event/seine Reihe.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse("Nicht autorisiert", { status: 401 })

  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return new NextResponse("Fehlende Event-ID", { status: 400 })

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: { include: { participant: true, ticketCategory: { select: { label: true } }, bringClaims: { select: { slot: { select: { label: true, position: true } } } } } }, series: true, toolLinks: { select: { type: true } }, _count: { select: { ticketCategories: true } } }
  })

  if (!event || !(await hasEventModeratorOrAbove(user, event))) return new NextResponse("Event nicht gefunden", { status: 404 })

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const customQuestions: string[] = event.formConfig ? (JSON.parse(event.formConfig).customQuestions || []) : []
  // Platz aus Seating nur als Spalte, wenn der Termin verknüpft ist (siehe app/api/seating/placements)
  const withSeating = event.toolLinks.some(l => l.type === 'seating')
  // Tickets und Bezahlung (docs/KONZEPT-TICKETS.md) nur als Spalten, wenn der Termin Kategorien oder Beträge hat
  const withTickets = event._count.ticketCategories > 0 || event.rsvps.some(r => r.amountCents)
  const isoDate = (d: Date | null) => d ? d.toISOString().split('T')[0] : ''

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
      "Datum",
      ...(withSeating ? ["Sitzplatz"] : []),
      ...(withTickets ? ["Kategorie", "Betrag", "Verwendungszweck", "Zahlstatus", "Bezahlt am", "Zahlart", "Erstattet am"] : []),
      ...customQuestions
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
      [...claimedLabels(rsvp), ...(rsvp.bringingItem ? [rsvp.bringingItem] : [])].join(", "),

      rsvp.isAttending ? (rsvp.additionalInfo || "") : (rsvp.declineReason || ""),

      rsvp.createdAt.toISOString().split('T')[0],

      ...(withSeating ? [rsvp.seatingLabel || ""] : []),

      ...(withTickets ? [
        rsvp.ticketCategory?.label || "",
        rsvp.amountCents ? (rsvp.amountCents / 100).toFixed(2).replace('.', ',') : "",
        rsvp.paymentReference || "",
        rsvp.amountCents ? PAYMENT_STATE_LABEL[paymentState(rsvp)].replace('-', '') : "",
        isoDate(rsvp.paidAt),
        rsvp.paidAt ? (rsvp.paymentMethod === 'CASH' ? "Bar" : "Überweisung") : "",
        isoDate(rsvp.refundedAt)
      ] : []),

      ...customQuestions.map((_, i) => {
        const answers: string[] = rsvp.customAnswers ? JSON.parse(rsvp.customAnswers) : []
        return answers[i] || ""
      })

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