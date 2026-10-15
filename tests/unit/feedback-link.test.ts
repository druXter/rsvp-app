import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  feedbackDue, feedbackEligible, feedbackLinkVisible, feedbackOpen, feedbackRoute, feedbackSubject, feedbackSurveyOf,
  parseFeedbackDelay, parseFeedbackUrl, readFeedbackSettings, signFeedbackToken
} from '../../app/lib/feedback-link'

// Feedback-Fragebogen (Idee L8 Teil 2): Link-Prüfung, wer darf, wann verschickt wird, und der Nachweis fürs
// Abstimmungstool (Gegenstück dort: verifyRsvpSurveyToken in app/lib/rsvp-verification.ts).
const ORIGIN = 'https://abstimmung.example.test'
const SECRET = 'test-poll-secret'
const hours = (n: number) => n * 60 * 60 * 1000
const now = new Date('2026-10-15T20:00:00Z')
const attending = { isAttending: true, isOnWaitlist: false, hasAttended: false }

beforeEach(() => {
  vi.stubEnv('ABSTIMMUNGSTOOL_BASE_URL', `${ORIGIN}/`)
  vi.stubEnv('POLL_VERIFICATION_SECRET', SECRET)
})
afterEach(() => vi.unstubAllEnvs())

/** Prüft einen Nachweis so, wie das Abstimmungstool es tut (Format und Signatur), und gibt die Payload zurück. */
function verifyLikeAbstimmungstool(token: string): Record<string, unknown> {
  const [payloadPart, signature] = token.split('.')
  expect(createHmac('sha256', SECRET).update(payloadPart).digest('base64url')).toBe(signature)
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
}

describe('Link zum Fragebogen', () => {
  it('nur Fragebögen des eingerichteten Abstimmungstools, normalisiert', () => {
    expect(parseFeedbackUrl('')).toBeNull()
    expect(parseFeedbackUrl(` ${ORIGIN}/fragebogen/cmabc123/ `)).toBe(`${ORIGIN}/fragebogen/cmabc123`)
    expect(parseFeedbackUrl(`${ORIGIN}/fragebogen/cmabc123?lang=en&x=1#a`)).toBe(`${ORIGIN}/fragebogen/cmabc123?lang=en`)
    for (const bad of [
      'https://fremd.example.test/fragebogen/cmabc123', `${ORIGIN}/cmabc123`, `${ORIGIN}/fragebogen/cmabc123/einbetten`,
      `${ORIGIN}/fragebogen/a%2Fb`, 'javascript:alert(1)', 'kein link'
    ]) expect(() => parseFeedbackUrl(bad), bad).toThrow(/Feedback-Fragebogen/)
  })

  it('ohne Abstimmungstool oder Secret: kein Feld, kein Fragebogen', () => {
    vi.stubEnv('POLL_VERIFICATION_SECRET', '')
    expect(() => parseFeedbackUrl(`${ORIGIN}/fragebogen/cmabc123`)).toThrow(/nicht eingerichtet/)
    expect(feedbackSurveyOf({ feedbackUrl: `${ORIGIN}/fragebogen/cmabc123` })).toBeNull()
  })

  it('gespeicherte Links werden bei jeder Verwendung gegen die Einrichtung geprüft', () => {
    expect(feedbackSurveyOf({ feedbackUrl: `${ORIGIN}/fragebogen/cmabc123?lang=en` })?.surveyId).toBe('cmabc123')
    expect(feedbackSurveyOf({ feedbackUrl: 'https://fremd.example.test/fragebogen/cmabc123' })).toBeNull()
    expect(feedbackSurveyOf({ feedbackUrl: null })).toBeNull()
  })

  it('Formular: Verzögerung nur aus der Auswahl, ohne Link keine Verzögerung, ohne Feld unverändert', () => {
    expect(parseFeedbackDelay('12')).toBe(12)
    expect(parseFeedbackDelay('0')).toBe(0)
    for (const bad of ['', '5', '-1', 'x', null]) expect(parseFeedbackDelay(bad)).toBeNull()
    const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f }
    expect(readFeedbackSettings(form({}))).toEqual({})
    expect(readFeedbackSettings(form({ feedbackUrl: `${ORIGIN}/fragebogen/cmabc123`, feedbackDelayHours: '24' }))).toEqual({ feedbackUrl: `${ORIGIN}/fragebogen/cmabc123`, feedbackDelayHours: 24 })
    expect(readFeedbackSettings(form({ feedbackUrl: '', feedbackDelayHours: '24' }))).toEqual({ feedbackUrl: null, feedbackDelayHours: null })
  })
})

describe('Wer und wann', () => {
  const event = { date: new Date(now.getTime() - hours(5)), duration: 4, datePending: false, enableCheckin: false, feedbackDelayHours: 0, feedbackUrl: `${ORIGIN}/fragebogen/cmabc123` }

  it('ab dem Ende, nie mit offenem Datum', () => {
    expect(feedbackOpen(event, now)).toBe(true)
    expect(feedbackOpen({ ...event, duration: 6 }, now)).toBe(false)
    expect(feedbackOpen({ ...event, datePending: true }, now)).toBe(false)
  })

  it('Zusage, die zählt; mit QR-Einlass nur Eingecheckte', () => {
    const verified = { isVerified: true }
    expect(feedbackEligible(event, attending, verified, false)).toBe(true)
    expect(feedbackEligible(event, { ...attending, isOnWaitlist: true }, verified, false)).toBe(false)
    expect(feedbackEligible(event, { ...attending, isAttending: false }, verified, false)).toBe(false)
    expect(feedbackEligible(event, attending, { isVerified: false }, true)).toBe(false)
    expect(feedbackEligible({ enableCheckin: true }, attending, verified, false)).toBe(false)
    expect(feedbackEligible({ enableCheckin: true }, { ...attending, hasAttended: true }, verified, false)).toBe(true)
  })

  it('sichtbar nur mit allem zusammen', () => {
    expect(feedbackLinkVisible(event, attending, { isVerified: false }, false, now)).toBe(true)
    expect(feedbackLinkVisible(event, null, { isVerified: false }, false, now)).toBe(false)
    expect(feedbackLinkVisible({ ...event, feedbackUrl: null }, attending, { isVerified: false }, false, now)).toBe(false)
    expect(feedbackLinkVisible({ ...event, duration: 6 }, attending, { isVerified: false }, false, now)).toBe(false)
  })

  it('Versand: nach der Verzögerung, höchstens eine Woche lang, nicht ohne Verzögerung', () => {
    const ended = (h: number) => ({ ...event, date: new Date(now.getTime() - hours(4 + h)) })
    expect(feedbackDue({ ...ended(11), feedbackDelayHours: 12 }, now)).toBe(false)
    expect(feedbackDue({ ...ended(12), feedbackDelayHours: 12 }, now)).toBe(true)
    expect(feedbackDue({ ...ended(12 + 7 * 24), feedbackDelayHours: 12 }, now)).toBe(true)
    expect(feedbackDue({ ...ended(13 + 7 * 24), feedbackDelayHours: 12 }, now)).toBe(false)
    expect(feedbackDue({ ...ended(1), feedbackDelayHours: null }, now)).toBe(false)
    expect(feedbackDue({ ...ended(1), datePending: true }, now)).toBe(false)
  })
})

describe('Nachweis fürs Abstimmungstool', () => {
  it('Format, Payload und Gültigkeit wie verifyRsvpSurveyToken erwartet', () => {
    const token = signFeedbackToken('cmabc123', 'rsvp-1', now)!
    const payload = verifyLikeAbstimmungstool(token)
    expect(payload).toEqual({ typ: 'survey-access', surveyId: 'cmabc123', sub: feedbackSubject('cmabc123', 'rsvp-1', SECRET), exp: now.getTime() / 1000 + 12 * 60 * 60 })
    // Kein Feld, das ein Abstimmungs-Token ausmacht - und keine personenbezogenen Daten
    expect(payload).not.toHaveProperty('pollId')
    expect(payload).not.toHaveProperty('email')
    expect(JSON.stringify(payload)).not.toContain('rsvp-1')
  })

  it('Pseudonym: stabil je Zusage und Fragebogen, sonst verschieden, im erlaubten Zeichenvorrat', () => {
    const sub = feedbackSubject('cmabc123', 'rsvp-1', SECRET)
    expect(sub).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(feedbackSubject('cmabc123', 'rsvp-1', SECRET)).toBe(sub)
    expect(feedbackSubject('cmabc123', 'rsvp-2', SECRET)).not.toBe(sub)
    expect(feedbackSubject('cmother', 'rsvp-1', SECRET)).not.toBe(sub)
  })

  it('ohne Secret kein Nachweis', () => {
    vi.stubEnv('POLL_VERIFICATION_SECRET', '')
    expect(signFeedbackToken('cmabc123', 'rsvp-1', now)).toBeNull()
  })

  it('Seite, Mail und Push verlinken nur auf die Route', () => {
    expect(feedbackRoute('ev1')).toBe('/api/feedback-link/ev1')
    expect(feedbackRoute('ev1', 'a b')).toBe('/api/feedback-link/ev1?token=a%20b')
  })
})
