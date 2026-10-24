// app/lib/feedback-link.ts
//
// Feedback-Fragebogen nach dem Event (Idee L8 Teil 2 der Suite, suite-kit docs/IDEEN.md): Ein Termin verweist auf
// einen Fragebogen im Abstimmungstool im Modus "Gäste aus rsvp-app" (dort Survey.identity = RSVP). Gäste kommen nie
// direkt dorthin, sondern über /api/feedback-link/[eventId]: Die Route prüft die Zusage und hängt einen frisch
// signierten Nachweis an (`?verify=`), den das Abstimmungstool mit verifyRsvpSurveyToken prüft. Rein, ohne DB.
import { createHmac } from 'node:crypto'
import { isConfirmedRsvp } from './linked-tools'
import { InputError } from './input-error'
import { eventEndsAt } from './photo-link'
import { signForPollTool } from './poll-verification'

/** So lange gilt ein Nachweis (Ausfüllen inklusive) - das Abstimmungstool nimmt höchstens 24 h an. */
export const FEEDBACK_TOKEN_TTL_SECONDS = 12 * 60 * 60
const FEEDBACK_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60
/** Später verschickt der Cron nichts mehr: kein überraschendes Feedback zu einem längst vergangenen Termin. */
export const FEEDBACK_SEND_WINDOW_DAYS = 7
/** Auswahl "Per Mail verschicken" im Termin-Formular: Stunden nach dem Ende (leer = nicht verschicken). */
export const FEEDBACK_DELAY_OPTIONS: { hours: number; label: string }[] = [
  { hours: 0, label: 'direkt nach dem Ende' },
  { hours: 3, label: '3 Stunden nach dem Ende' },
  { hours: 12, label: '12 Stunden nach dem Ende' },
  { hours: 24, label: 'einen Tag nach dem Ende' },
  { hours: 48, label: 'zwei Tage nach dem Ende' }
]

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function abstimmungstoolOrigin(): string | null {
  const url = process.env.ABSTIMMUNGSTOOL_BASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Ist der Feedback-Fragebogen eingerichtet (Adresse des Abstimmungstools und gemeinsames Secret)? */
export function feedbackConfigured(): boolean {
  return !!abstimmungstoolOrigin() && !!process.env.POLL_VERIFICATION_SECRET
}

/** Origin, den das Termin-Formular als Platzhalter zeigt - null blendet das Feld aus. */
export function allowedFeedbackOrigin(): string | null {
  return feedbackConfigured() ? abstimmungstoolOrigin() : null
}

const SURVEY_PATH = /^\/fragebogen\/([A-Za-z0-9_-]{1,100})\/?$/

/** Fragebogen-ID aus einem Link `<Abstimmungstool>/fragebogen/<id>`, null bei jedem anderen Link. */
function surveyIdOf(url: URL, origin: string): string | null {
  if (url.origin !== origin) return null
  return url.pathname.match(SURVEY_PATH)?.[1] ?? null
}

/**
 * Prüft den Link aus dem Termin-Formular: leer = kein Fragebogen, sonst genau `<ABSTIMMUNGSTOOL_BASE_URL>/fragebogen/<id>`.
 * Gespeichert wird die normalisierte Adresse ohne Query (ein ?lang=en bleibt erhalten). Wirft mit einer Meldung fürs Formular.
 */
export function parseFeedbackUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const origin = allowedFeedbackOrigin()
  if (!origin) throw new InputError('Feedback-Fragebogen: Das Abstimmungstool ist hier nicht eingerichtet.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InputError('Feedback-Fragebogen: Ungültiger Link.')
  }
  const surveyId = surveyIdOf(url, origin)
  if (!surveyId) throw new InputError(`Feedback-Fragebogen: Erwartet wird der Link eines Fragebogens aus dem Abstimmungstool, z. B. ${origin}/fragebogen/…`)
  const target = new URL(`/fragebogen/${surveyId}`, origin)
  if (url.searchParams.get('lang') === 'en') target.searchParams.set('lang', 'en')
  return target.toString()
}

/** Auswahl "Per Mail verschicken": nur die angebotenen Werte, alles andere = nicht verschicken. */
export function parseFeedbackDelay(value: FormDataEntryValue | null): number | null {
  const hours = typeof value === 'string' && value !== '' ? Number(value) : NaN
  return FEEDBACK_DELAY_OPTIONS.some(o => o.hours === hours) ? hours : null
}

/**
 * Liest die Felder aus dem Termin-Formular. Fehlt das Feld (Abstimmungstool nicht eingerichtet, Formular ohne
 * Abschnitt), bleibt alles, wie es ist. Ohne Fragebogen wird auch nichts verschickt.
 */
export function readFeedbackSettings(formData: FormData): { feedbackUrl?: string | null; feedbackDelayHours?: number | null } {
  if (!formData.has('feedbackUrl')) return {}
  const feedbackUrl = parseFeedbackUrl(formData.get('feedbackUrl') as string || '')
  return { feedbackUrl, feedbackDelayHours: feedbackUrl ? parseFeedbackDelay(formData.get('feedbackDelayHours')) : null }
}

/**
 * Der Fragebogen eines Termins - bei jeder Verwendung gegen die aktuelle Einrichtung geprüft (wie die Links zu
 * verknüpften Tools): Zeigt der gespeicherte Link nicht mehr auf das eingerichtete Abstimmungstool, gibt es keinen.
 */
export function feedbackSurveyOf(event: { feedbackUrl: string | null }): { surveyId: string; url: URL } | null {
  const origin = feedbackConfigured() ? abstimmungstoolOrigin() : null
  if (!event.feedbackUrl || !origin) return null
  try {
    const url = new URL(event.feedbackUrl)
    const surveyId = surveyIdOf(url, origin)
    return surveyId ? { surveyId, url } : null
  } catch {
    return null
  }
}

/** Ab dem Ende des Termins (vorher gibt es nichts zu bewerten), nie mit offenem Datum. */
export function feedbackOpen(event: { date: Date; duration: number; datePending: boolean }, now: Date = new Date()): boolean {
  return !event.datePending && now >= eventEndsAt(event)
}

/**
 * Wer Feedback geben darf: eine Zusage, die zählt (wie bei den verknüpften Tools), und - wenn der Termin QR-Einlass
 * hat - nur, wer tatsächlich eingecheckt wurde. Ohne Einlass weiß niemand, wer da war; dann alle Zusagen.
 */
export function feedbackEligible(
  event: { enableCheckin: boolean },
  rsvp: { isAttending: boolean; isOnWaitlist: boolean; hasAttended: boolean },
  participant: { isVerified: boolean },
  requireVerification: boolean
): boolean {
  return isConfirmedRsvp(rsvp, participant, requireVerification) && (!event.enableCheckin || rsvp.hasAttended)
}

/** Zeigt die Event-Seite "Feedback geben"? Gleiche Regeln wie die Route (die trotzdem selbst prüft). */
export function feedbackLinkVisible(
  event: { feedbackUrl: string | null; date: Date; duration: number; datePending: boolean; enableCheckin: boolean },
  rsvp: { isAttending: boolean; isOnWaitlist: boolean; hasAttended: boolean } | null,
  participant: { isVerified: boolean } | null,
  requireVerification: boolean,
  now: Date = new Date()
): boolean {
  return !!rsvp && !!participant && !!feedbackSurveyOf(event) && feedbackOpen(event, now) && feedbackEligible(event, rsvp, participant, requireVerification)
}

/** Fällig für den Versand per Mail: eingestellte Verzögerung nach dem Ende erreicht, aber nicht älter als das Fenster. */
export function feedbackDue(
  event: { date: Date; duration: number; datePending: boolean; feedbackDelayHours: number | null },
  now: Date = new Date()
): boolean {
  if (event.feedbackDelayHours === null || event.datePending) return false
  const due = eventEndsAt(event).getTime() + event.feedbackDelayHours * 60 * 60 * 1000
  return now.getTime() >= due && now.getTime() <= due + FEEDBACK_SEND_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Pseudonym einer Zusage für genau einen Fragebogen: HMAC über Fragebogen und Rsvp-ID. Das Abstimmungstool erkennt
 * daran "dieselbe Zusage" (eine Antwort, änderbar), erfährt aber weder Name noch E-Mail noch die Rsvp-ID, und
 * Pseudonyme verschiedener Fragebögen lassen sich nicht verknüpfen.
 */
export function feedbackSubject(surveyId: string, rsvpId: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(`survey-sub\u0000${surveyId}\u0000${rsvpId}`).digest())
}

/**
 * Nachweis für das Abstimmungstool (Gegenstück zu dessen verifyRsvpSurveyToken): gleiches Format und Secret wie die
 * übrigen Nachrichten dieser Kopplung (app/lib/poll-verification.ts), Nachricht `survey-access` mit `surveyId` und
 * `sub`. Als einzige länger als eine Stunde gültig, weil sie das Ausfüllen überdauern muss (auf beiden Seiten
 * ausdrücklich erlaubt).
 * null ohne POLL_VERIFICATION_SECRET.
 */
export function signFeedbackToken(surveyId: string, rsvpId: string, now: Date = new Date()): string | null {
  const secret = process.env.POLL_VERIFICATION_SECRET
  if (!secret) return null
  return signForPollTool('survey-access', { surveyId, sub: feedbackSubject(surveyId, rsvpId, secret) }, {
    audience: allowedFeedbackOrigin(), ttlSeconds: FEEDBACK_TOKEN_TTL_SECONDS, maxTtlSeconds: FEEDBACK_TOKEN_MAX_TTL_SECONDS, now
  })
}

/** Weg über rsvp-app (Seite, Mail, Push) - nie der Fragebogen-Link selbst, der allein öffnet kein Formular. */
export function feedbackRoute(eventId: string, editToken?: string | null): string {
  return `/api/feedback-link/${eventId}${editToken ? `?token=${encodeURIComponent(editToken)}` : ''}`
}
