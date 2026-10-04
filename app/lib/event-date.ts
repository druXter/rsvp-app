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

/**
 * Reihen-Termine verschwinden 48 Stunden nach ihrem Beginn aus den Listen: Nutzer sehen sie in
 * der Reihen-Übersicht und auf /mein-konto nicht mehr, Verwaltungskonten finden sie im
 * eingeklappten "Archiv" der Reihe. Die Termin-Seite selbst bleibt erreichbar (persönlicher
 * Link aus der Mail); gelöscht wird erst nach EVENT_RETENTION_MONTHS (cron/cleanup).
 */
export const ARCHIVE_AFTER_MS = 48 * 60 * 60 * 1000

/** Ein Termin mit noch offenem Datum (datePending) ist nie archiviert - `date` ist dann nur ein Platzhalter. */
export function isArchived(event: Dated, now: Date = new Date()): boolean {
  if (event.datePending) return false
  return new Date(event.date).getTime() + ARCHIVE_AFTER_MS <= now.getTime()
}

/** Teilt nach Datum aufsteigend sortierte Termine in aktuelle und archivierte (neueste zuerst). */
export function splitArchived<T extends Dated>(events: T[], now: Date = new Date()): { current: T[]; archived: T[] } {
  const current: T[] = []
  const archived: T[] = []
  for (const event of events) (isArchived(event, now) ? archived : current).push(event)
  return { current, archived: archived.reverse() }
}
