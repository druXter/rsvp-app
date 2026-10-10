// app/lib/event-summary.ts
//
// Kennzahlen eines Termins für Übersicht und Event-Seite der Verwaltung (docs/KONZEPT-OBERFLAECHE.md) - an EINER
// Stelle berechnet, damit beide dieselben Zahlen zeigen. Rein, ohne Datenbank.
import { seatsOf } from './persons'
import { paymentState } from './payment-state'

type SummaryRsvp = {
  isAttending: boolean
  isOnWaitlist: boolean
  hasAttended: boolean
  amountCents: number | null
  paidAt: Date | null
  refundedAt: Date | null
  paymentDueAt: Date | null
  persons?: readonly { isAttending: boolean; ageGroup: string }[]
}

export type EventSummary = {
  /** Antworten mit Zusage und festem Platz */
  confirmed: number
  /** Plätze dieser Zusagen (Personen ohne Kleinkinder) */
  seats: number
  waitlist: number
  declined: number
  checkedIn: number
  /** Zahlungen offen / überfällig (Anzahl) und offener Betrag */
  paymentsOpen: number
  paymentsOverdue: number
  openCents: number
  paidCents: number
  /** Einladungen ohne Antwort (nur Einladungsmodus) */
  invitationsOpen: number | null
}

export function summarizeEvent(rsvps: readonly SummaryRsvp[], invitationCount: number | null = null, now = new Date()): EventSummary {
  const fixed = rsvps.filter(r => r.isAttending && !r.isOnWaitlist)
  const states = rsvps.map(r => ({ r, state: paymentState(r, now) }))
  return {
    confirmed: fixed.length,
    seats: fixed.reduce((sum, r) => sum + seatsOf(r.persons), 0),
    waitlist: rsvps.filter(r => r.isAttending && r.isOnWaitlist).length,
    declined: rsvps.filter(r => !r.isAttending).length,
    checkedIn: rsvps.filter(r => r.hasAttended).length,
    paymentsOpen: states.filter(x => x.state === 'open' || x.state === 'overdue').length,
    paymentsOverdue: states.filter(x => x.state === 'overdue').length,
    openCents: states.filter(x => x.state === 'open' || x.state === 'overdue').reduce((sum, x) => sum + (x.r.amountCents ?? 0), 0),
    paidCents: states.filter(x => x.state === 'paid').reduce((sum, x) => sum + (x.r.amountCents ?? 0), 0),
    invitationsOpen: invitationCount === null ? null : Math.max(invitationCount - rsvps.length, 0)
  }
}

/** Liegt der Termin in der Vergangenheit (Ende = Beginn + Dauer)? Termine mit offenem Datum zählen als anstehend. */
export function isPastEvent(event: { date: Date; duration: number; datePending: boolean }, now = new Date()): boolean {
  return !event.datePending && event.date.getTime() + event.duration * 3_600_000 < now.getTime()
}
