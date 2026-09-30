// app/lib/event-date.ts

/**
 * Anzeige des Termin-Datums an EINER Stelle - berücksichtigt Event.datePending ("Datum noch
 * offen", per Terminabstimmung im Abstimmungstool, siehe app/lib/poll-date.ts): Dann ist
 * `date` nur ein Platzhalter und darf Gästen nie als Termin erscheinen.
 */

export const DATE_PENDING_TEXT = 'Datum wird noch abgestimmt'

type Dated = { date: Date | string; datePending?: boolean | null }

/** "Mittwoch, 07. Oktober 2026 um 19:00 Uhr" (long) bzw. "Mi., 07.10., 19:00 Uhr" (short) - oder DATE_PENDING_TEXT. */
export function formatEventDate(event: Dated, style: 'long' | 'short' = 'long'): string {
  if (event.datePending) return DATE_PENDING_TEXT
  const formatted = new Date(event.date).toLocaleString('de-DE', style === 'long'
    ? { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `${formatted} Uhr`
}
