// app/lib/rsvp-deadline.ts
//
// Antwortfrist (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 5): optionales Datum pro Termin, gespeichert als Ende des
// Tages in Berliner Zeit. Danach können Gäste nichts mehr ändern, nur die
// Verwaltung. Reine Funktionen, auch im Browser nutzbar.
import { InputError } from './input-error'

const TIME_ZONE = 'Europe/Berlin'

/** Abstand der Berliner Ortszeit zu UTC in Millisekunden zum Zeitpunkt `at` (Sommer-/Winterzeit). */
function berlinOffset(at: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(at)).map(p => [p.type, p.value]))
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at
}

/**
 * "2027-05-30" aus dem Datumsfeld -> 30.05.2027 23:59:59 Berliner Zeit, unabhängig von der Zeitzone des Servers.
 * Leer -> null. Wirft bei Unsinn.
 */
export function parseDeadline(value: string): Date | null {
  if (!value.trim()) return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new InputError('Antwortfrist: Bitte ein gültiges Datum eintragen.')
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const wall = Date.UTC(year, month - 1, day, 23, 59, 59)
  if (new Date(wall).getUTCDate() !== day || new Date(wall).getUTCMonth() !== month - 1) throw new InputError('Antwortfrist: Bitte ein gültiges Datum eintragen.')
  return new Date(wall - berlinOffset(wall))
}

/** Gegenstück für das Datumsfeld (YYYY-MM-DD in Berliner Zeit). */
export function deadlineInputValue(deadline: Date | null | undefined): string {
  return deadline ? deadline.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }) : ''
}

/** "Sonntag, 30. Mai 2027" für Formular und Mails, null ohne Frist. */
export function formatDeadline(deadline: Date | null | undefined): string | null {
  return deadline ? deadline.toLocaleDateString('de-DE', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null
}

/** Ist die Antwortfrist abgelaufen? */
export function deadlinePassed(event: { rsvpDeadline: Date | null }, now = new Date()): boolean {
  return !!event.rsvpDeadline && now > event.rsvpDeadline
}

/**
 * "2027-05-30T18:00" aus einem datetime-local-Feld als Berliner Ortszeit -> Zeitpunkt, unabhängig von der Zeitzone
 * des Servers. null bei Unsinn. (Erinnerungszeitpunkt bei „Vielleicht“, app/lib/maybe.ts)
 */
export function parseBerlinDateTime(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  if (new Date(wall).getUTCDate() !== day || new Date(wall).getUTCMonth() !== month - 1) return null
  // Zweimal gerechnet, damit auch Zeitpunkte direkt an der Umstellung auf Sommer-/Winterzeit stimmen
  const guess = wall - berlinOffset(wall)
  return new Date(wall - berlinOffset(guess))
}

/** Gegenstück für ein datetime-local-Feld ("YYYY-MM-DDTHH:mm" in Berliner Zeit). */
export function berlinDateTimeInputValue(at: Date): string {
  const shifted = new Date(at.getTime() + berlinOffset(at.getTime()))
  return shifted.toISOString().slice(0, 16)
}
