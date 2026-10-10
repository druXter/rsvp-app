// app/lib/guest-ticketing.ts
//
// Tickets, Zahlung und Sitzplatz für die Gästeseiten (app/[slug]/page.tsx und der Reihen-Termin), an EINER
// Stelle berechnet, damit beide Seiten dieselben Regeln anzeigen (docs/KONZEPT-TICKETS.md).
import type { Event, Rsvp } from '@prisma/client'
import { prisma } from './prisma'
import { ticketCategoriesForForm, type TicketCategoryForForm } from './tickets'
import { paymentInfoOf, type PaymentInfo } from './payment'
import { isSeatingConfirmed, seatingLinkOf } from './seating'
import type { StoredToolLink } from './linked-tools'

export async function guestTicketing(
  event: Event & { toolLinks: StoredToolLink[] },
  existingRsvp: Rsvp | null,
  participantVerified: boolean,
  requireVerification: boolean
): Promise<{ ticketCategories: TicketCategoryForForm[]; payment: PaymentInfo | null; canChooseSeat: boolean; seatAfterPayment: boolean }> {
  const ticketCategories = await ticketCategoriesForForm(event.id, existingRsvp?.id ?? null)
  const category = existingRsvp?.ticketCategoryId
    ? await prisma.ticketCategory.findUnique({ where: { id: existingRsvp.ticketCategoryId }, select: { label: true } })
    : null
  const payment = existingRsvp ? await paymentInfoOf({ ...existingRsvp, ticketCategory: category }, event) : null

  const linked = !!seatingLinkOf(event) && !!existingRsvp
  const verified = { isVerified: participantVerified }
  const canChooseSeat = linked && isSeatingConfirmed(existingRsvp!, verified, requireVerification, event.seatingRequiresPayment)
  // Würde ohne "erst nach Zahlung" zählen - dann Hinweis statt Knopf
  const seatAfterPayment = linked && !canChooseSeat && isSeatingConfirmed(existingRsvp!, verified, requireVerification, false)
  return { ticketCategories, payment, canChooseSeat, seatAfterPayment }
}
