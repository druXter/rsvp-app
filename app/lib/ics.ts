// app/lib/ics.ts
import { createEvent, type DateArray } from 'ics'

/**
 * Kalenderdatei (.ics) eines Termins - für den Anhang der Bestätigungs- und Änderungs-Mail (app/lib/mail.ts) und den
 * Download nach dem Antworten (app/api/ical/[id]). EINE Stelle, damit beide gleich aussehen.
 *
 * - Ende als DTEND, nicht als DURATION: Beides erlaubt RFC 5545, aber nicht jeder Kalender versteht DURATION - der
 *   Termin-Dialog, den iOS aus einem Mail-Anhang öffnet, zeigt dann kein Ende (beim Import über „Dateien“ ging es).
 * - Stabile UID je Termin und SEQUENCE (Event.icsSequence): Eine erneut geöffnete Datei aktualisiert den Eintrag,
 *   statt ihn zu verdoppeln.
 * - Als Anhang mit `charset=utf-8` (ICS_CONTENT_TYPE) - Beschreibungen enthalten Umlaute und Emojis.
 * - Zeilen höchstens 75 Bytes (foldIcs): Die Bibliothek bricht nach 75 ZEICHEN um, mit Umlauten und Emojis werden
 *   Zeilen so deutlich länger - strenge Kalender verwerfen dann z.B. die Beschreibung.
 */

export const ICS_CONTENT_TYPE = 'text/calendar; charset=utf-8; method=PUBLISH'

export type IcsEvent = {
  id: string
  title: string
  location: string | null
  date: Date
  /** Dauer in Stunden */
  duration: number
  icsSequence: number
}

function utcArray(date: Date): DateArray {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
}

/** Stabile UID eines Termins (`event-<id>@<host>`). */
export function icsUid(eventId: string, baseUrl: string): string {
  let host = 'rsvp-app.local'
  try {
    host = new URL(baseUrl).host
  } catch {
    // baseUrl ungültig (lokale Entwicklung ohne BASE_URL) - nur Eindeutigkeit innerhalb dieser Installation zählt
  }
  return `event-${eventId}@${host}`
}

const MAX_OCTETS = 75

/**
 * Zeilen nach RFC 5545 Abschnitt 3.1 umbrechen: höchstens 75 Bytes je Zeile (die Fortsetzungszeile beginnt mit einem
 * Leerzeichen, das mitzählt), nie mitten in einem Zeichen (Code Point). Vorhandene Umbrüche werden vorher aufgehoben.
 */
export function foldIcs(text: string): string {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const folded: string[] = []
  for (const line of lines) {
    let current = ''
    let bytes = 0
    let limit = MAX_OCTETS
    for (const char of line) {
      const size = Buffer.byteLength(char)
      if (bytes + size > limit) {
        folded.push(current)
        current = ' '
        bytes = 1
        limit = MAX_OCTETS
      }
      current += char
      bytes += size
    }
    folded.push(current)
  }
  return folded.join('\r\n')
}

/** Die Datei als Text oder null, wenn sie sich nicht erzeugen lässt. */
export function buildEventIcs(event: IcsEvent, description: string, baseUrl: string): string | null {
  const start = new Date(event.date)
  const end = new Date(start.getTime() + event.duration * 60 * 60 * 1000)
  const { error, value } = createEvent({
    uid: icsUid(event.id, baseUrl),
    sequence: event.icsSequence,
    title: event.title,
    description,
    location: event.location || '',
    start: utcArray(start),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: utcArray(end),
    endInputType: 'utc',
    endOutputType: 'utc'
  })
  return error || !value ? null : foldIcs(value)
}
