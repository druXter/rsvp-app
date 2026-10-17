// app/ui/kit.tsx
//
// Bausteine der Oberfläche: die gemeinsamen aus suite-kit/ui (Gestaltung für alle Tools der Suite, siehe
// docs/DESIGN.md in suite-kit), dazu die eigenen von rsvp-app.
export * from 'suite-kit/ui'

/** "Mo, 12.10.2026, 19:00" bzw. "Datum offen". */
export function formatShortDate(date: Date, pending = false): string {
  if (pending) return 'Datum offen'
  return date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
