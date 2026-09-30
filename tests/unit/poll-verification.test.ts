import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractPollId, signPollVerificationToken, signRsvpWebhookPayload, verifyPollDateMessage, verifyResultWebhookPayload
} from '../../app/lib/poll-verification'

// Das Token-Format ist mit dem Abstimmungstool vereinbart (dessen README, "Token-Format"):
// `${base64url(JSON)}.${base64url(HMAC-SHA256(payloadPart, secret))}`. Hier bewusst unabhängig
// nachgebaut, damit die Tests das Format prüfen und nicht die Implementierung gegen sich selbst.
const SECRET = 'unit-test-secret'

function sign(payload: object, secret = SECRET): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadPart}.${createHmac('sha256', secret).update(payloadPart).digest('base64url')}`
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

const now = () => Math.floor(Date.now() / 1000)
const result = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }],
  closedAt: '2026-09-01T18:00:00.000Z', exp: now() + 600, ...overrides
})

beforeEach(() => vi.stubEnv('POLL_VERIFICATION_SECRET', SECRET))
afterEach(() => vi.unstubAllEnvs())

describe('verifyResultWebhookPayload (eingehende Ergebnis-Meldung)', () => {
  it('Positivkontrolle: gültig signierte Meldung wird angenommen', () => {
    expect(verifyResultWebhookPayload(sign(result()))).toEqual({
      eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }], closedAt: '2026-09-01T18:00:00.000Z'
    })
  })

  it('lehnt manipulierte Signatur und manipulierten Inhalt ab', () => {
    const token = sign(result())
    const [payloadPart, signature] = token.split('.')
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A')
    expect(verifyResultWebhookPayload(`${payloadPart}.${flipped}`)).toBeNull()
    const otherPayload = sign(result({ eventId: 'event-2' })).split('.')[0]
    expect(verifyResultWebhookPayload(`${otherPayload}.${signature}`)).toBeNull()
  })

  it('lehnt abgelaufene Meldungen und fehlende Ablaufzeit ab', () => {
    expect(verifyResultWebhookPayload(sign(result({ exp: now() - 1 })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ exp: undefined })))).toBeNull()
    expect(verifyResultWebhookPayload(sign(result({ exp: String(now() + 600) })))).toBeNull()
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
    const click = signPollVerificationToken('a@example.test', 'https://abstimmung.example/p/poll-1', true)!
    const webhook = signRsvpWebhookPayload('a@example.test', 'https://abstimmung.example/p/poll-1', 'event-1', true)!
    expect(verifyResultWebhookPayload(click)).toBeNull()
    expect(verifyResultWebhookPayload(webhook.body)).toBeNull()
  })
})

describe('ausgehende Tokens', () => {
  it('Klick-Token: Format, Bindung an die Abstimmung, 10 Minuten gültig', () => {
    const token = signPollVerificationToken('a@example.test', 'https://abstimmung.example/p/poll-1?x=1', false)!
    const [payloadPart, signature] = token.split('.')
    expect(signature).toBe(createHmac('sha256', SECRET).update(payloadPart).digest('base64url'))
    const payload = decode(token)
    expect(payload).toMatchObject({ email: 'a@example.test', pollId: 'poll-1', attending: false })
    expect(payload.exp - now()).toBeGreaterThan(595)
    expect(payload.exp - now()).toBeLessThanOrEqual(600)
  })

  it('Zu-/Absage-Meldung: trägt eventId, gleiches Format', () => {
    const signed = signRsvpWebhookPayload('a@example.test', 'https://abstimmung.example/p/poll-1', 'event-1', true)!
    expect(signed.pollId).toBe('poll-1')
    expect(decode(signed.body)).toMatchObject({ email: 'a@example.test', pollId: 'poll-1', eventId: 'event-1', attending: true })
    expect(sign(decode(signed.body))).toBe(signed.body)
  })

  it('ohne Geheimnis oder ohne auslesbare Poll-ID gibt es keinen Token', () => {
    expect(signPollVerificationToken('a@example.test', 'keine url', true)).toBeNull()
    expect(signPollVerificationToken('a@example.test', 'https://abstimmung.example/', true)).toBeNull()
    vi.stubEnv('POLL_VERIFICATION_SECRET', '')
    expect(signPollVerificationToken('a@example.test', 'https://abstimmung.example/p/poll-1', true)).toBeNull()
    expect(signRsvpWebhookPayload('a@example.test', 'https://abstimmung.example/p/poll-1', 'event-1', true)).toBeNull()
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
    typ: 'poll-date-set', pollId: 'poll-1', pollTitle: 'Sommerfest', startsAt: '2026-10-07T17:00:00.000Z',
    owner, create: true, skipEmailHashes: ['a'.repeat(64)], exp: now() + 300, ...overrides
  })

  it('liest Status- und Termin-Meldung', () => {
    expect(verifyPollDateMessage(sign({ typ: 'poll-date-status', pollId: 'poll-1', owner, exp: now() + 300 })))
      .toEqual({ typ: 'poll-date-status', pollId: 'poll-1', owner })
    const message = verifyPollDateMessage(sign(set()))
    expect(message).toMatchObject({ typ: 'poll-date-set', pollTitle: 'Sommerfest', create: true, skipEmailHashes: ['a'.repeat(64)] })
    expect(message?.typ === 'poll-date-set' && message.startsAt.toISOString()).toBe('2026-10-07T17:00:00.000Z')
  })

  it('lehnt andere Nachrichtenarten desselben Secrets ab (kein typ)', () => {
    expect(verifyPollDateMessage(sign(result()))).toBeNull()
    expect(verifyPollDateMessage(sign({ email: 'a@example.test', pollId: 'poll-1', attending: true, exp: now() + 300 }))).toBeNull()
    expect(verifyPollDateMessage(sign(set({ typ: 'poll-date-unbekannt' })))).toBeNull()
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
