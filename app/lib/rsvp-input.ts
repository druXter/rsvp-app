// app/lib/rsvp-input.ts
// Grenzen für die Angaben einer Antwort (performRsvpSubmission) und des zentralen Profils eines Teilnehmendenkontos.
// Rein, ohne Datenbank - auch im Browser nutzbar (maxLength der Formularfelder).

/**
 * Höchstlängen in Zeichen. Großzügig für echte Angaben, aber nicht beliebig: Name, Mitbringsel und Absagegrund stehen
 * in Mails, Push-Mitteilungen und der öffentlichen Gästeliste, und ohne Grenze speicherte die Datenbank, was in die
 * Anfrage passt (docs/AUDIT-2026-11.md, R-13). 254 ist die Höchstlänge einer E-Mail-Adresse (RFC 5321).
 */
export const RSVP_LIMITS = { name: 100, email: 254, phone: 50, dietaryOption: 200, allergies: 500, text: 1000 } as const

// Genau EINE nackte Adresse (docs/AUDIT-2026-11.md, R-07): isSingleEmail aus suite-kit/web (seit v0.15.0) - ohne
// Leerraum, Steuerzeichen und <>()"[]\,;:, höchstens 254 Zeichen. nodemailer liest "a@x, b@y" sonst als zwei
// Empfänger und stellt "(x)a@x" oder "x<a@x>" an a@x zu. Überall, wo eine E-Mail-Adresse angenommen wird.
export { isSingleEmail } from 'suite-kit/web'

/** Die erste zu lange Angabe als Meldung für den Gast, sonst null. */
export function tooLongField(fields: [label: string, value: string | null | undefined, max: number][]): string | null {
  const hit = fields.find(([, value, max]) => !!value && value.length > max)
  return hit ? `${hit[0]} ist zu lang (höchstens ${hit[2]} Zeichen).` : null
}
