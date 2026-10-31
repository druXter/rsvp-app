// app/lib/reconfirm.ts
//
// Rückbestätigung vor dem Termin (Idee L30): Bei vollen, kostenlosen Terminen erscheinen oft 10-30 % der Zusagen
// nicht. Ist Event.reconfirmDays gesetzt, fragt der Erinnerungs-Cron so viele Tage vor Beginn jede feste Zusage
// „Kommst du noch?“ (Mail und Push, Knöpfe auf der Gästeseite). Wer bestätigt, behält den Platz; wer absagt, gibt ihn
// sofort an die Warteliste. Ohne Antwort bis zur Frist (24 h vor Beginn) steht die Zusage als „unbestätigt“ in der
// Gästeliste - oder wird mit Event.reconfirmAutoDecline abgesagt. Reine Funktionen, auch im Browser nutzbar;
// Datenbank und Versand in reconfirm-store.ts.
import { InputError } from './input-error'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Frist der Rückbestätigung: so lange vor Beginn. */
export const RECONFIRM_DEADLINE_BEFORE_START = DAY
/** Automatisch abgesagt wird nur, wer mindestens so lange vor der Frist gefragt wurde. */
export const RECONFIRM_MIN_ANSWER_TIME = DAY
export const RECONFIRM_DAYS_MIN = 2
export const RECONFIRM_DAYS_MAX = 30

type ReconfirmSettings = { reconfirmDays: number | null; date: Date; datePending: boolean }
type ReconfirmRsvp = {
  isAttending: boolean
  isOnWaitlist: boolean
  shiftHelperId: string | null
  hasAttended: boolean
  reconfirmAskedAt: Date | null
  reconfirmedAt: Date | null
}

/**
 * Zeitraum der Rückbestätigung: ab `askFrom` wird gefragt, `deadline` ist die Frist. null = aus (kein Wert, Datum noch
 * offen per Terminabstimmung).
 */
export function reconfirmWindow(event: ReconfirmSettings): { askFrom: Date; deadline: Date } | null {
  if (event.reconfirmDays === null || event.datePending) return null
  const start = event.date.getTime()
  return { askFrom: new Date(start - event.reconfirmDays * DAY), deadline: new Date(start - RECONFIRM_DEADLINE_BEFORE_START) }
}

/** Läuft die Rückbestätigung gerade (gefragt wird ab askFrom bis zum Beginn - bestätigen geht auch nach der Frist)? */
export function reconfirmRunning(event: ReconfirmSettings, now = new Date()): boolean {
  const window = reconfirmWindow(event)
  return !!window && now.getTime() >= window.askFrom.getTime() && now.getTime() < event.date.getTime()
}

/**
 * Betrifft die Rückbestätigung diese Antwort? Feste Zusagen (`confirmed` = isConfirmedRsvp, also auch bestätigte
 * Adresse, wo nötig), außer Helfer*innen aus Schichten (sagen nur dort ab) und schon Eingecheckten.
 */
export function reconfirmApplies(rsvp: ReconfirmRsvp, confirmed: boolean): boolean {
  return confirmed && !rsvp.shiftHelperId && !rsvp.hasAttended
}

/** Steht für diese Antwort jetzt noch eine Rückbestätigung aus? (Knöpfe auf der Gästeseite, „unbestätigt“) */
export function reconfirmPending(event: ReconfirmSettings, rsvp: ReconfirmRsvp, confirmed: boolean, now = new Date()): boolean {
  return reconfirmRunning(event, now) && reconfirmApplies(rsvp, confirmed) && !rsvp.reconfirmedAt
}

/**
 * Darf die Zusage an der Frist automatisch abgesagt werden? Nur gefragte Zusagen, die mindestens 24 Stunden Zeit zum
 * Antworten hatten, und nie Zusagen mit Ticketpreis (bezahlte bzw. zu bezahlende Plätze klärt die Verwaltung).
 * Einladungen gibt es hier nicht: Rückbestätigung und Einladungsmodus schließen sich aus.
 */
export function autoDeclinable(rsvp: ReconfirmRsvp & { amountCents: number | null }, deadline: Date): boolean {
  return !!rsvp.reconfirmAskedAt && !rsvp.amountCents
    && rsvp.reconfirmAskedAt.getTime() <= deadline.getTime() - RECONFIRM_MIN_ANSWER_TIME
}

export type ReconfirmStatus = 'confirmed' | 'open' | 'unconfirmed' | 'lapsed' | null

/**
 * Stand für die Gästeliste der Verwaltung: bestätigt, gefragt (Frist läuft), unbestätigt (Frist vorbei) bzw. verfallen
 * (automatisch abgesagt). null = nichts anzuzeigen (aus, noch nicht im Zeitraum, betrifft die Antwort nicht).
 */
export function reconfirmStatus(event: ReconfirmSettings, rsvp: ReconfirmRsvp & { reconfirmLapsedAt: Date | null }, confirmed: boolean, now = new Date()): ReconfirmStatus {
  if (rsvp.reconfirmLapsedAt && !rsvp.isAttending) return 'lapsed'
  const window = reconfirmWindow(event)
  if (!window || now.getTime() < window.askFrom.getTime() || !reconfirmApplies(rsvp, confirmed)) return null
  if (rsvp.reconfirmedAt) return 'confirmed'
  return now.getTime() < window.deadline.getTime() ? 'open' : 'unconfirmed'
}

export const RECONFIRM_STATUS_LABELS: Record<Exclude<ReconfirmStatus, null>, string> = {
  confirmed: 'bestätigt',
  open: 'Rückbestätigung offen',
  unconfirmed: 'unbestätigt',
  lapsed: 'nicht bestätigt, abgesagt'
}

/** "Mi., 12.05.2027, 18:00 Uhr" in Berliner Zeit. */
export function formatReconfirmTime(at: Date): string {
  return `${at.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr`
}

/**
 * Einstellungen aus dem Formular (Abschnitt „Erinnerung und Einlass“). Ohne Marker `reconfirmShown` bleibt alles,
 * wie es ist. Wirft InputError bei ungültiger Tageszahl.
 */
export function readReconfirmSettings(formData: FormData): { reconfirmDays?: number | null; reconfirmAutoDecline?: boolean } {
  if (!formData.has('reconfirmShown')) return {}
  if (formData.get('reconfirm') !== 'on') return { reconfirmDays: null, reconfirmAutoDecline: false }
  const days = Number(formData.get('reconfirmDays'))
  if (!Number.isInteger(days) || days < RECONFIRM_DAYS_MIN || days > RECONFIRM_DAYS_MAX) {
    throw new InputError(`Rückbestätigung: Bitte ${RECONFIRM_DAYS_MIN} bis ${RECONFIRM_DAYS_MAX} Tage vor dem Termin wählen.`)
  }
  return { reconfirmDays: days, reconfirmAutoDecline: formData.get('reconfirmAutoDecline') === 'on' }
}

/** Rückbestätigung und Einladungsmodus schließen sich aus (Einladungen haben Antwortfrist und eigene Erinnerung). */
export function assertReconfirmAllowed(reconfirmDays: number | null | undefined, inviteOnly: boolean) {
  if (reconfirmDays != null && inviteOnly) {
    throw new InputError('Die Rückbestätigung gibt es nicht im Einladungsmodus - dort gilt die Antwortfrist mit Erinnerung.')
  }
}

/**
 * Was die Gästeseite für „Kommst du noch?“ braucht. null = die Rückbestätigung läuft nicht oder es gibt keine Antwort;
 * sonst bleibt der Kasten eingehängt und zeigt die Frage nur, solange sie offen ist (`pending`).
 */
export function reconfirmForGuest(
  event: ReconfirmSettings & { reconfirmAutoDecline: boolean },
  rsvp: ReconfirmRsvp | null,
  confirmed: boolean,
  now = new Date()
): { pending: boolean; deadline: string | null; autoDecline: boolean } | null {
  if (!rsvp || !reconfirmRunning(event, now)) return null
  const deadline = reconfirmWindow(event)!.deadline
  return {
    pending: reconfirmPending(event, rsvp, confirmed, now),
    deadline: deadline.getTime() > now.getTime() ? formatReconfirmTime(deadline) : null,
    autoDecline: event.reconfirmAutoDecline
  }
}
