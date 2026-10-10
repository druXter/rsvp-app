// app/lib/payment-state.ts
//
// Reine Funktionen zu Beträgen und Zahlstatus (docs/KONZEPT-TICKETS.md) - ohne Datenbank, damit auch
// Client-Komponenten (Gästeformular, Zahlungsspalte der Verwaltung) sie importieren können. Alles mit
// Datenbank, GiroCode und Mail steht in app/lib/payment.ts.

/** Betrag in Cent als deutscher Euro-Betrag ("25,00 €"). */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
export function formatPaymentDate(date: Date): string {
  return dateFormat.format(date)
}

export type PaymentState = 'none' | 'open' | 'overdue' | 'paid' | 'refund-open' | 'refunded'

export type PaymentFields = {
  isAttending: boolean
  isOnWaitlist: boolean
  amountCents: number | null
  paymentDueAt: Date | null
  paidAt: Date | null
  refundedAt: Date | null
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  none: '-',
  open: 'Offen',
  overdue: 'Überfällig',
  paid: 'Bezahlt',
  'refund-open': 'Erstattung offen',
  refunded: 'Erstattet'
}

/**
 * Zahlstatus einer Antwort. Fällig ist nur ein fester Platz mit Betrag - wer auf der Warteliste steht, zahlt
 * erst nach dem Nachrücken. Wer bezahlt und dann abgesagt hat, wartet auf die Erstattung.
 */
export function paymentState(r: PaymentFields, now: Date = new Date()): PaymentState {
  if (r.paidAt) {
    if (r.isAttending) return 'paid'
    return r.refundedAt ? 'refunded' : 'refund-open'
  }
  if (!r.amountCents || !r.isAttending || r.isOnWaitlist) return 'none'
  return r.paymentDueAt && r.paymentDueAt < now ? 'overdue' : 'open'
}

/** Muss diese Antwort (noch) zahlen? Offen oder überfällig. */
export function paymentDue(r: PaymentFields, now: Date = new Date()): boolean {
  const state = paymentState(r, now)
  return state === 'open' || state === 'overdue'
}
