import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractPollId, signPollVerificationToken, signRsvpWebhookPayload, verifyPollDateMessage, verifyResultWebhookPayload
} from '../../app/lib/poll-verification'

// Kopplung mit dem Abstimmungstool im Format der Suite (suite-kit signLinkMessage):
// `${base64url(JSON)}.${base64url(HMAC-SHA256(payloadPart, secret))}`, Nutzlast `{ typ, aud, ...felder, iat, exp }`.
// Hier bewusst unabhängig nachgebaut, damit die Tests das Format prüfen und nicht die Implementierung gegen sich selbst.
const SECRET = 'unit-test-secret'
const RSVP = 'https://rsvp.example.test'
const VOTE = 'https://vote.example.test'

function sign(payload: object, secret = SECRET): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadPart}.${createHmac('sha256', secret).update(payloadPart).digest('base64url')}`
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

const now = () => Math.floor(Date.now() / 1000)
const result = (overrides: Record<string, unknown> = {}) => ({
  typ: 'poll-result', aud: RSVP,
  eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }],
  closedAt: '2026-09-01T18:00:00.000Z', iat: now(), exp: now() + 600, ...overrides
})

beforeEach(() => {
  vi.stubEnv('POLL_VERIFICATION_SECRET', SECRET)
  vi.stubEnv('BASE_URL', RSVP)
  vi.stubEnv('ABSTIMMUNGSTOOL_BASE_URL', VOTE)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('feste Prüfnachrichten (gleich im Unit-Test des Abstimmungstools, tests/unit/rsvp-verification.test.ts)', () => {
  const AT = new Date('2026-10-24T10:00:00Z')

  it('Ergebnis-Meldung vom Abstimmungstool wird angenommen', () => {
    vi.useFakeTimers({ now: AT })
    const FIXED_RESULT = 'eyJ0eXAiOiJwb2xsLXJlc3VsdCIsImF1ZCI6Imh0dHBzOi8vcnN2cC5leGFtcGxlLnRlc3QiLCJldmVudElkIjoiZXZlbnQtMSIsInBvbGxJZCI6InBvbGwtMSIsInBvbGxUaXRsZSI6IldvaGluPyIsIndpbm5lcnMiOlt7ImxhYmVsIjoiS2lubyIsInZvdGVzIjoyfV0sImNsb3NlZEF0IjoiMjAyNi0wOS0wMVQxODowMDowMC4wMDBaIiwicXVvcnVtTWV0Ijp0cnVlLCJ1bml0Ijoidm90ZXMiLCJpYXQiOjE3OTI4MzYwMDAsImV4cCI6MTc5MjgzNjYwMH0.kq-1tB0Vzwh9K7oe8nEmhT7lPNGpYw2Rp05LXNTKDMU'
    expect(verifyResultWebhookPayload(FIXED_RESULT)).toEqual({
      eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }],
      closedAt: '2026-09-01T18:00:00.000Z', quorumMet: true, unit: 'votes'
    })
  })

  it('Klick-Token ans Abstimmungstool sieht genau so aus', () => {
    vi.useFakeTimers({ now: AT })
    expect(signPollVerificationToken('anna@example.test', `${VOTE}/poll-1`, true)).toBe(
      'eyJ0eXAiOiJwb2xsLWFjY2VzcyIsImF1ZCI6Imh0dHBzOi8vdm90ZS5leGFtcGxlLnRlc3QiLCJlbWFpbCI6ImFubmFAZXhhbXBsZS50ZXN0IiwicG9sbElkIjoicG9sbC0xIiwiYXR0ZW5kaW5nIjp0cnVlLCJpYXQiOjE3OTI4MzYwMDAsImV4cCI6MTc5MjgzNjYwMH0.pdxpIG9LATlTKa_74NxLzV3AbjEdU2A2aqcz7SwCJGs'
    )
  })
})

describe('verifyResultWebhookPayload (eingehende Ergebnis-Meldung)', () => {
  it('Positivkontrolle: gültig signierte Meldung wird angenommen', () => {
    expect(verifyResultWebhookPayload(sign(result()))).toEqual({
      eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }], closedAt: '2026-09-01T18:00:00.000Z',
      // Ältere Meldungen ohne die optionalen Felder: beschlussfähig, Stimmen
      quorumMet: true, unit: 'votes'
    })
  })

  it('liest die optionalen Felder quorumMet und unit - und lehnt kaputte Werte ab', () => {
    expect(verifyResultWebhookPayload(sign(result({ quorumMet: false, unit: 'points' })))).toMatchObject({ quorumMet: false, unit: 'points' })
    expect(verifyResultWebhookPayload(sign(result({ quorumMet: 'nein' })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ unit: 'euro' })))).toBeNull()
  })

  it('nur mit typ poll-result und uns als Empfänger', () => {
    expect(verifyResultWebhookPayload(sign(result({ typ: undefined })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ typ: 'poll-date-set' })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ aud: undefined })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ aud: VOTE })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ aud: `${RSVP}/` })))).toBeNull()
  })

  it('lehnt manipulierte Signatur und manipulierten Inhalt ab', () => {
    const token = sign(result())
    const [payloadPart, signature] = token.split('.')
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A')
    expect(verifyResultWebhookPayload(`${payloadPart}.${flipped}`)).toBeNull()
    const otherPayload = sign(result({ eventId: 'event-2' })).split('.')[0]
    expect(verifyResultWebhookPayload(`${otherPayload}.${signature}`)).toBeNull()
  })

  it('lehnt abgelaufene Meldungen, fehlende Zeiten und zu lange Gültigkeit ab', () => {
    expect(verifyResultWebhookPayload(sign(result({ exp: now() - 1 })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ exp: undefined })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ iat: undefined })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ exp: String(now() + 600) })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ exp: now() + 16 * 60 })))).toBeNull()
  })

  it('lehnt ein falsches Geheimnis ab - und ohne konfiguriertes Geheimnis jede Meldung', () => {
    expect(verifyResultWebhookPayload(sign(result(), 'anderes-geheimnis'))).toBeNull()
    vi.stubEnv('POLL_VERIFICATION_SECRET', '')
    expect(verifyResultWebhookPayload(sign(result()))).toBeNull()
    // Auch nicht mit einer über den leeren Schlüssel "gültigen" Signatur.
    expect(verifyResultWebhookPayload(sign(result(), ''))).toBeNull()
  })

  it('lehnt kaputte Tokens und fehlende Pflichtfelder ab, ohne zu werfen', () => {
    for (const token of [undefined, null, '', 'abc', 'a.b.c', '.', 'x.', '.y', sign(result()) + '.z']) {
      expect(verifyResultWebhookPayload(token)).toBeNull()
    }
    const notJson = Buffer.from('kein json').toString('base64url')
    expect(verifyResultWebhookPayload(`${notJson}.${createHmac('sha256', SECRET).update(notJson).digest('base64url')}`)).toBeNull()
    for (const field of ['eventId', 'pollId', 'pollTitle', 'closedAt', 'winners']) {
      expect(verifyResultWebhookPayload(sign(result({ [field]: undefined }))), field).toBeNull()
    }
    expect(verifyResultWebhookPayload(sign(result({ eventId: '' })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ winners: 'Kino' })))).toBeNull()
  })

  it('eigene ausgehende Tokens lassen sich nicht als Ergebnis zurückspielen', () => {
    const click = signPollVerificationToken('a@example.test', `${RSVP}/p/poll-1`, true)!
    const webhook = signRsvpWebhookPayload('a@example.test', `${VOTE}/p/poll-1`, 'event-1', true)!
    expect(verifyResultWebhookPayload(click)).toBeNull()
    expect(verifyResultWebhookPayload(webhook.body)).toBeNull()
  })
})

describe('ausgehende Tokens', () => {
  it('Klick-Token: Format, Bindung an Abstimmung und deren Origin, 10 Minuten gültig', () => {
    const token = signPollVerificationToken('a@example.test', 'https://abstimmung.example/p/poll-1?x=1', false)!
    const [payloadPart, signature] = token.split('.')
    expect(signature).toBe(createHmac('sha256', SECRET).update(payloadPart).digest('base64url'))
    const payload = decode(token)
    expect(payload).toMatchObject({ typ: 'poll-access', aud: 'https://abstimmung.example', email: 'a@example.test', pollId: 'poll-1', attending: false })
    expect(payload.exp - payload.iat).toBe(600)
    expect(payload.exp - now()).toBeGreaterThan(595)
  })

  it('Zu-/Absage-Meldung: eigene Art, trägt eventId, an ABSTIMMUNGSTOOL_BASE_URL', () => {
    const signed = signRsvpWebhookPayload('a@example.test', `${VOTE}/p/poll-1`, 'event-1', true)!
    expect(signed.pollId).toBe('poll-1')
    expect(decode(signed.body)).toMatchObject({ typ: 'poll-attendance', aud: VOTE, email: 'a@example.test', pollId: 'poll-1', eventId: 'event-1', attending: true })
    expect(sign(decode(signed.body))).toBe(signed.body)
  })

  it('ohne Geheimnis, ohne Abstimmungstool-Adresse oder ohne auslesbare Poll-ID gibt es keinen Token', () => {
    expect(signPollVerificationToken('a@example.test', 'keine url', true)).toBeNull()
    expect(signPollVerificationToken('a@example.test', 'https://abstimmung.example/', true)).toBeNull()
    vi.stubEnv('ABSTIMMUNGSTOOL_BASE_URL', '')
    expect(signRsvpWebhookPayload('a@example.test', `${VOTE}/p/poll-1`, 'event-1', true)).toBeNull()
    vi.stubEnv('ABSTIMMUNGSTOOL_BASE_URL', VOTE)
    vi.stubEnv('POLL_VERIFICATION_SECRET', '')
    expect(signPollVerificationToken('a@example.test', 'https://abstimmung.example/p/poll-1', true)).toBeNull()
    expect(signRsvpWebhookPayload('a@example.test', `${VOTE}/p/poll-1`, 'event-1', true)).toBeNull()
  })
})

describe('extractPollId', () => {
  it('nimmt das letzte Pfadsegment ohne Query', () => {
    expect(extractPollId('https://abstimmung.example/p/cmXYZ')).toBe('cmXYZ')
    expect(extractPollId('https://abstimmung.example/p/cmXYZ/?lang=de#x')).toBe('cmXYZ')
    expect(extractPollId('https://abstimmung.example')).toBeNull()
    expect(extractPollId('kein link')).toBeNull()
  })
})

describe('verifyPollDateMessage (Terminabstimmung)', () => {
  const owner = { toolUserId: 'tool-user-1', rsvpUserId: null }
  const set = (overrides: Record<string, unknown> = {}) => ({
    typ: 'poll-date-set', aud: RSVP, pollId: 'poll-1', pollTitle: 'Sommerfest', startsAt: '2026-10-07T17:00:00.000Z',
    owner, create: true, skipEmailHashes: ['a'.repeat(64)], iat: now(), exp: now() + 300, ...overrides
  })

  it('liest Status- und Termin-Meldung', () => {
    expect(verifyPollDateMessage(sign({ typ: 'poll-date-status', aud: RSVP, pollId: 'poll-1', owner, iat: now(), exp: now() + 300 })))
      .toEqual({ typ: 'poll-date-status', pollId: 'poll-1', owner })
    const message = verifyPollDateMessage(sign(set()))
    expect(message).toMatchObject({ typ: 'poll-date-set', pollTitle: 'Sommerfest', create: true, skipEmailHashes: ['a'.repeat(64)] })
    expect(message?.typ === 'poll-date-set' && message.startsAt.toISOString()).toBe('2026-10-07T17:00:00.000Z')
  })

  it('lehnt andere Nachrichtenarten desselben Secrets und fremde Empfänger ab', () => {
    expect(verifyPollDateMessage(sign(result()))).toBeNull()
    expect(verifyPollDateMessage(sign({ typ: 'poll-access', aud: RSVP, email: 'a@example.test', pollId: 'poll-1', attending: true, iat: now(), exp: now() + 300 }))).toBeNull()
    expect(verifyPollDateMessage(sign(set({ typ: 'poll-date-unbekannt' })))).toBeNull()
    expect(verifyPollDateMessage(sign(set({ aud: VOTE })))).toBeNull()
  })

  it('lehnt falsche Signatur, Ablauf und zu lange Gültigkeit ab', () => {
    expect(verifyPollDateMessage(sign(set(), 'anderes-secret'))).toBeNull()
    expect(verifyPollDateMessage(sign(set({ exp: now() - 1 })))).toBeNull()
    expect(verifyPollDateMessage(sign(set({ exp: now() + 16 * 60 })))).toBeNull()
  })

  it('lehnt kaputte Felder ab', () => {
    for (const overrides of [
      { startsAt: 'morgen' }, { pollTitle: '' }, { create: 'ja' }, { skipEmailHashes: ['kein-hash'] },
      { owner: { rsvpUserId: null } }, { owner: { toolUserId: 'x', rsvpUserId: 5 } }, { pollId: '../admin' }
    ]) {
      expect(verifyPollDateMessage(sign(set(overrides))), JSON.stringify(overrides)).toBeNull()
    }
  })
})
