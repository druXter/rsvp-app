// app/lib/maybe.ts
//
// Antwort „Vielleicht“ (Idee L26, docs/KONZEPT-VIELLEICHT.md): Gäste legen sich noch nicht fest, wählen einen
// Erinnerungszeitpunkt und müssen bis zum Stichtag zu- oder absagen, sonst gilt die Antwort als Absage. Gespeichert
// als Absage (Rsvp.isAttending false + isMaybe bzw. RsvpPerson.isMaybe), damit jedes verknüpfte Tool „Vielleicht“
// wie eine Absage behandelt. Reine Funktionen, auch im Browser nutzbar; Datenbank und Versand in maybe-store.ts.
import { berlinDateTimeInputValue } from './rsvp-deadline'

const HOUR = 60 * 60 * 1000
/** Ohne frühere Antwortfrist ist der Stichtag so lange vor Beginn. */
export const MAYBE_CUTOFF_BEFORE_START = 12 * HOUR
/** Die Erinnerung liegt mindestens so lange vor dem Stichtag. */
export const MAYBE_REMINDER_LEAD = 24 * HOUR

const TIME_ZONE = 'Europe/Berlin'

type MaybeSettings = { allowMaybe: boolean; series?: { allowMaybe: boolean } | null }
type MaybeDates = { date: Date; datePending: boolean; rsvpDeadline: Date | null }

/** „Vielleicht“ erlaubt? Bei Reihen-Terminen gilt die Einstellung der Reihe (wie requireVerification). */
export function effectiveAllowMaybe(event: MaybeSettings): boolean {
  return event.series ? event.series.allowMaybe : event.allowMaybe
}

/**
 * Stichtag: der frühere Zeitpunkt aus Antwortfrist und Beginn − 12 h. Danach wird ein verbliebenes „Vielleicht“ zur
 * Absage. null = noch keiner (Datum offen per Terminabstimmung und keine Antwortfrist).
 */
export function maybeCutoff(event: MaybeDates): Date | null {
  const candidates = [
    ...(event.rsvpDeadline ? [event.rsvpDeadline.getTime()] : []),
    ...(event.datePending ? [] : [event.date.getTime() - MAYBE_CUTOFF_BEFORE_START])
  ]
  return candidates.length > 0 ? new Date(Math.min(...candidates)) : null
}

export function floorToHour(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR) * HOUR)
}

/** Die nächste volle Stunde echt nach `now`. */
export function nextFullHour(now: Date): Date {
  return new Date(floorToHour(now).getTime() + HOUR)
}

/** Spätester Erinnerungszeitpunkt (volle Stunde, 24 h vor dem Stichtag). null = nicht begrenzt. */
export function latestMaybeReminder(event: MaybeDates): Date | null {
  const cutoff = maybeCutoff(event)
  return cutoff ? floorToHour(new Date(cutoff.getTime() - MAYBE_REMINDER_LEAD)) : null
}

/** Kann ein Gast jetzt „Vielleicht“ wählen? Erlaubt und noch mindestens eine volle Stunde für die Erinnerung frei. */
export function maybeAvailable(event: MaybeSettings & MaybeDates, now = new Date()): boolean {
  if (!effectiveAllowMaybe(event)) return false
  const latest = latestMaybeReminder(event)
  return !latest || nextFullHour(now).getTime() <= latest.getTime()
}

/** Vorschlag fürs Formular: der späteste erlaubte Zeitpunkt, ohne Grenze in einer Woche. */
export function defaultMaybeReminder(event: MaybeDates, now = new Date()): Date {
  return latestMaybeReminder(event) ?? floorToHour(new Date(now.getTime() + 7 * 24 * HOUR))
}

/**
 * Prüft den gewählten Erinnerungszeitpunkt (auf die volle Stunde abgerundet): in der Zukunft und spätestens 24 h vor
 * dem Stichtag. Fehler als Text fürs Formular.
 */
export function checkMaybeReminder(event: MaybeDates, remindAt: Date | null, now = new Date()): { error: string } | { remindAt: Date } {
  if (!remindAt || Number.isNaN(remindAt.getTime())) return { error: 'Bitte wähle, wann wir dich erinnern sollen.' }
  const rounded = floorToHour(remindAt)
  if (rounded.getTime() <= now.getTime()) return { error: 'Der Erinnerungszeitpunkt muss in der Zukunft liegen (volle Stunde).' }
  const latest = latestMaybeReminder(event)
  if (latest && rounded.getTime() > latest.getTime()) {
    return { error: `Die Erinnerung muss spätestens ${formatMaybeTime(latest)} sein - 24 Stunden vor dem Stichtag (${formatMaybeTime(maybeCutoff(event)!)}).` }
  }
  return { remindAt: rounded }
}

/** Steht in dieser Antwort noch etwas auf „vielleicht“ (ganze Antwort oder eine Person des Haushalts)? */
export function hasOpenMaybe(rsvp: { isMaybe: boolean; persons?: readonly { isMaybe: boolean }[] | null }): boolean {
  return rsvp.isMaybe || !!rsvp.persons?.some(p => p.isMaybe)
}

/** "Mo., 12.05.2027, 18:00 Uhr" in Berliner Zeit. */
export function formatMaybeTime(at: Date): string {
  return `${at.toLocaleString('de-DE', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr`
}

/**
 * Stand für die Gästeliste der Verwaltung: ohne bestätigte Adresse läuft keine Erinnerung.
 */
export function maybeStatusLabel(
  rsvp: { maybeRemindAt: Date | null; maybeRemindedAt: Date | null },
  participant: { email: string | null; isVerified: boolean }
): string {
  if (!participant.email || !participant.isVerified) return 'Mail nicht bestätigt'
  if (rsvp.maybeRemindedAt) return `erinnert am ${formatMaybeTime(rsvp.maybeRemindedAt)}`
  if (rsvp.maybeRemindAt) return `Erinnerung ${formatMaybeTime(rsvp.maybeRemindAt)}`
  return 'keine Erinnerung aktiv'
}

/** Was das Gästeformular für „Vielleicht“ braucht (Felder im datetime-local-Format, Berliner Zeit). */
export type MaybeForForm = {
  /** frühester und spätester Erinnerungszeitpunkt (max null = offen) und der vorbelegte Wert */
  min: string
  max: string | null
  value: string
  /** Stichtag als Text, null solange keiner feststeht */
  cutoff: string | null
  /** Termin mit Kapazität: eine spätere Zusage kann auf der Warteliste landen */
  capacity: boolean
}

/** null, wenn „Vielleicht“ gerade nicht wählbar ist. Eine bestehende Erinnerung bleibt vorbelegt, solange sie passt. */
export function maybeForForm(
  event: MaybeSettings & MaybeDates & { maxCapacity: number | null },
  rsvp: { maybeRemindAt: Date | null } | null,
  now = new Date()
): MaybeForForm | null {
  if (!maybeAvailable(event, now)) return null
  const min = nextFullHour(now)
  const latest = latestMaybeReminder(event)
  const own = rsvp?.maybeRemindAt
  const value = own && own.getTime() >= min.getTime() && (!latest || own.getTime() <= latest.getTime()) ? own : defaultMaybeReminder(event, now)
  const cutoff = maybeCutoff(event)
  return {
    min: berlinDateTimeInputValue(min),
    max: latest ? berlinDateTimeInputValue(latest) : null,
    value: berlinDateTimeInputValue(value),
    cutoff: cutoff ? formatMaybeTime(cutoff) : null,
    capacity: event.maxCapacity !== null
  }
}
