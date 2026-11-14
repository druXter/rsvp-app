// app/lib/guest-retention.ts
// Rein (ohne Datenbank), damit auch die Mail-Texte die Frist nennen können; Löschen in guest-retention-store.ts

/** Teilnehmendenkonten ohne Login so lange (Datenschutzerklärung „Speicherdauer“). */
export const GUEST_ACCOUNT_INACTIVITY_YEARS = 2

/**
 * Unbestätigte Teilnehmendenkonten so viele Tage nach der Registrierung. Bis dahin gilt auch ihr Bestätigungs-Link.
 * Ein Konto unter fremder Adresse (Tippfehler oder Absicht) blockiert die Adresse sonst für immer, und sein Link
 * bliebe ewig klickbar - bestätigt die echte Person ihn, kennt der Anleger das Passwort (docs/AUDIT-2026-11.md,
 * „Konto unter fremder Adresse vorab anlegen“).
 */
export const UNVERIFIED_GUEST_ACCOUNT_DAYS = 7

/** Registrierungen vor diesem Zeitpunkt sind abgelaufen, solange sie unbestätigt sind. */
export function unverifiedGuestCutoff(now = Date.now()): Date {
  return new Date(now - UNVERIFIED_GUEST_ACCOUNT_DAYS * 24 * 60 * 60 * 1000)
}
