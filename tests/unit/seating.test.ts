import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_TOKEN_AGE_SECONDS, createMessage, guestOf, isSeatingConfirmed, openMessage, originOf, parseSeatingUrl,
  readLimitedText, seatingSecret, signMessage, verifyMessage
} from '../../app/lib/seating'

// Vertrag mit Seating (app/lib/seating.ts). Die Werte stammen aus Seatings eigenem
// tests/unit/rsvp/token.test.ts; die beiden festen Nachrichten unten hat Seatings createMessage
// (app/lib/rsvp/token.ts dort) mit genau diesen Werten erzeugt - sie prüfen, dass beide Seiten
// dasselbe Format sprechen, nicht nur diese Implementierung gegen sich selbst.
const secret = 'test-secret-0123456789abcdef0123456789'
const audience = 'https://rsvp.example.test'
const seatingOrigin = 'https://plaetze.example.test'
const now = new Date('2026-10-01T12:00:00Z')
const at = (seconds: number) => Math.floor(now.getTime() / 1000) + seconds
const seatingEventId = 'cmseatingevent00001'
const rsvpEventId = 'cmrsvpevent00000001'

const SEATING_GUEST_LIST_REQUEST =
  'eyJ0eXAiOiJndWVzdC1saXN0LXJlcXVlc3QiLCJhdWQiOiJodHRwczovL3JzdnAuZXhhbXBsZS50ZXN0Iiwic2VhdGluZ0V2ZW50SWQiOiJjbXNlYXRpbmdldmVudDAwMDAxIiwicnN2cEV2ZW50SWQiOiJjbXJzdnBldmVudDAwMDAwMDAxIiwiaWF0IjoxNzkwODU2MDAwLCJleHAiOjE3OTA4NTY2MDB9.nb70PDBZfGFjseKMau_C3h8obhMZRVKkzSZZ6BJcBHc'
const SEATING_PLACEMENTS =
  'eyJ0eXAiOiJwbGFjZW1lbnRzIiwiYXVkIjoiaHR0cHM6Ly9yc3ZwLmV4YW1wbGUudGVzdCIsInNlYXRpbmdFdmVudElkIjoiY21zZWF0aW5nZXZlbnQwMDAwMSIsInJzdnBFdmVudElkIjoiY21yc3ZwZXZlbnQwMDAwMDAwMSIsInBsYWNlbWVudHMiOlt7InJzdnBJZCI6ImNtcnN2cGFuc3dlcjAwMDAwMDEiLCJsYWJlbCI6IlRpc2NoIDcsIFBsw6R0emUgMywgNCJ9XSwiaWF0IjoxNzkwODU2MDAwLCJleHAiOjE3OTA4NTY2MDB9.ih0uJlee-vBGzGrlOol91lcqxkN2WJkb5j45HN8UX_s'

function request(extra: Record<string, unknown> = {}) {
  return { typ: 'guest-list-request', aud: audience, iat: at(0), exp: at(600), seatingEventId, rsvpEventId, ...extra }
}

describe('Format wie im Vertrag mit Seating', () => {
  it('base64url(JSON).base64url(HMAC-SHA256(payloadPart))', () => {
    const token = signMessage({ a: 1 }, secret)
    const [payload, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ a: 1 })
    expect(signature).toBe(createHmac('sha256', secret).update(payload).digest('base64url'))
    expect(token).not.toMatch(/[=+/]/)
  })

  it('falsche Signatur, fremdes Secret, kaputtes Format: null', () => {
    const token = signMessage({ a: 1 }, secret)
    expect(openMessage(token, secret)).toEqual({ a: 1 })
    expect(openMessage(token, 'anderes-secret-0123456789abcdef0123')).toBeNull()
    expect(openMessage(`${token}x`, secret)).toBeNull()
    expect(openMessage(token.split('.')[0], secret)).toBeNull()
    expect(openMessage('a.b.c', secret)).toBeNull()
    const forged = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')
    expect(openMessage(`${forged}.${token.split('.')[1]}`, secret)).toBeNull()
    expect(openMessage(`${token.split('.')[0]}.`, secret)).toBeNull()
    expect(openMessage(42, secret)).toBeNull()
  })

  it('von Seating signierte Nachrichten werden angenommen', () => {
    expect(verifyMessage(SEATING_GUEST_LIST_REQUEST, 'guest-list-request', { secret, audience, now }))
      .toMatchObject({ seatingEventId, rsvpEventId, iat: at(0), exp: at(600) })
    expect(verifyMessage(SEATING_PLACEMENTS, 'placements', { secret, audience, now }))
      .toMatchObject({ placements: [{ rsvpId: 'cmrsvpanswer0000001', label: 'Tisch 7, Plätze 3, 4' }] })
  })

  it('eigene Nachrichten sind byte-gleich zu denen von Seating (gleiche Schlüsselreihenfolge)', () => {
    const token = createMessage('guest-list-request', { aud: audience, seatingEventId, rsvpEventId }, secret, { now })
    expect(token).toBe(SEATING_GUEST_LIST_REQUEST)
  })
})

describe('verifyMessage', () => {
  const verify = (extra: Record<string, unknown>) => verifyMessage(signMessage(request(extra), secret), 'guest-list-request', { secret, audience, now })

  it('lehnt falsche Art, falschen Empfänger, Ablauf und zu lange Gültigkeit ab', () => {
    expect(verify({})).not.toBeNull()
    expect(verify({ typ: 'placements' })).toBeNull()
    expect(verify({ aud: seatingOrigin })).toBeNull()
    expect(verify({ exp: at(0) })).toBeNull()
    expect(verify({ exp: at(-1) })).toBeNull()
    expect(verify({ exp: at(MAX_TOKEN_AGE_SECONDS + 5) })).toBeNull()
    expect(verify({ exp: at(MAX_TOKEN_AGE_SECONDS) })).not.toBeNull()
    expect(verify({ iat: at(600) })).toBeNull()
    expect(verify({ iat: at(30) })).not.toBeNull() // Uhr-Toleranz
    expect(verify({ exp: 'morgen' })).toBeNull()
    expect(verify({ iat: 1.5 })).toBeNull()
  })

  it('lehnt ungültige ids ab', () => {
    expect(verify({ seatingEventId: 'X' })).toBeNull()
    expect(verify({ rsvpEventId: '../x' })).toBeNull()
    expect(verify({ rsvpEventId: undefined })).toBeNull()
  })

  it('placements: Inhalt wird geprüft', () => {
    const placements = (list: unknown) => verifyMessage(signMessage({ ...request(), typ: 'placements', placements: list }, secret), 'placements', { secret, audience, now })
    expect(placements([])).toMatchObject({ placements: [] })
    expect(placements([{ rsvpId: 'cmrsvpanswer0000001', label: ' Tisch\u00007  ' }])).toMatchObject({ placements: [{ label: 'Tisch 7' }] })
    expect(placements([{ rsvpId: '../x', label: 'Tisch 1' }])).toBeNull()
    expect(placements([{ rsvpId: 'cmrsvpanswer0000001', label: 'x'.repeat(501) }])).toBeNull()
    expect(placements([{ rsvpId: 'cmrsvpanswer0000001' }])).toBeNull()
    expect(placements('Tisch 1')).toBeNull()
    expect(placements(Array(5001).fill({ rsvpId: 'cmrsvpanswer0000001', label: '' }))).toBeNull()
  })

  it('eine Nachricht der einen Art gilt nie als eine andere', () => {
    const change = createMessage('rsvp-change', {
      aud: audience, seatingEventId, rsvpEventId, rsvpId: 'cmrsvpanswer0000001', attending: false, name: 'Erika', email: null, companions: []
    }, secret, { now })
    expect(verifyMessage(change, 'rsvp-change', { secret, audience, now })).toMatchObject({ attending: false })
    expect(verifyMessage(change, 'placements', { secret, audience, now })).toBeNull()
    expect(verifyMessage(change, 'guest-list-request', { secret, audience, now })).toBeNull()
  })

  it('createMessage setzt iat/exp und kappt die Gültigkeit auf eine Stunde', () => {
    expect(openMessage(createMessage('guest-list-request', { aud: audience, seatingEventId, rsvpEventId }, secret, { now, ttlSeconds: 120 }), secret))
      .toMatchObject({ typ: 'guest-list-request', iat: at(0), exp: at(120) })
    expect(openMessage(createMessage('guest-list-request', { aud: audience, seatingEventId, rsvpEventId }, secret, { now, ttlSeconds: 99_999 }), secret))
      .toMatchObject({ exp: at(MAX_TOKEN_AGE_SECONDS) })
  })
})

describe('Inhalte an Seating', () => {
  it('guestOf: Name bereinigt und nie leer, Begleitung als Name oder null, zu lange Adresse fällt weg', () => {
    expect(guestOf({ id: 'r1', plusOne: true, plusOneName: ' Max ' }, { name: ' Erika  Muster ', email: 'erika@example.test' }))
      .toEqual({ rsvpId: 'r1', name: 'Erika Muster', email: 'erika@example.test', companions: ['Max'] })
    expect(guestOf({ id: 'r1', plusOne: true, plusOneName: null }, { name: '   ', email: null }))
      .toEqual({ rsvpId: 'r1', name: 'Gast', email: null, companions: [null] })
    expect(guestOf({ id: 'r1', plusOne: false, plusOneName: 'Max' }, { name: 'x'.repeat(300), email: `${'a'.repeat(250)}@x.de` }))
      .toMatchObject({ name: 'x'.repeat(100), email: null, companions: [] })
  })

  it('isSeatingConfirmed: nur Zusage, nicht Warteliste, bei Verifizierungspflicht nur verifiziert', () => {
    const yes = { isAttending: true, isOnWaitlist: false }
    expect(isSeatingConfirmed(yes, { isVerified: false }, false)).toBe(true)
    expect(isSeatingConfirmed(yes, { isVerified: false }, true)).toBe(false)
    expect(isSeatingConfirmed(yes, { isVerified: true }, true)).toBe(true)
    expect(isSeatingConfirmed({ isAttending: true, isOnWaitlist: true }, { isVerified: true }, false)).toBe(false)
    expect(isSeatingConfirmed({ isAttending: false, isOnWaitlist: false }, { isVerified: true }, false)).toBe(false)
  })
})

describe('Konfiguration', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.SEATING_SECRET = secret
    process.env.POLL_VERIFICATION_SECRET = 'poll-secret-0123456789abcdef0123456789'
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('Secret: mindestens 32 Zeichen und nie das Secret des Abstimmungstools', () => {
    expect(seatingSecret()).toBe(secret)
    process.env.SEATING_SECRET = 'zu-kurz'
    expect(seatingSecret()).toBeNull()
    process.env.SEATING_SECRET = process.env.POLL_VERIFICATION_SECRET
    expect(seatingSecret()).toBeNull()
    delete process.env.SEATING_SECRET
    expect(seatingSecret()).toBeNull()
  })

  it('parseSeatingUrl: nur <SEATING_BASE_URL>/rsvp/<id>, kanonisch ohne Query', () => {
    expect(parseSeatingUrl(`${seatingOrigin}/rsvp/${seatingEventId}`, seatingOrigin))
      .toEqual({ url: `${seatingOrigin}/rsvp/${seatingEventId}`, origin: seatingOrigin, seatingEventId })
    expect(parseSeatingUrl(` ${seatingOrigin}/rsvp/${seatingEventId}/?x=1#a `, seatingOrigin)?.url).toBe(`${seatingOrigin}/rsvp/${seatingEventId}`)
    expect(parseSeatingUrl(`https://intern.example.test/rsvp/${seatingEventId}`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`http://plaetze.example.test/rsvp/${seatingEventId}`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`https://a:b@plaetze.example.test/rsvp/${seatingEventId}`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`${seatingOrigin}/b/${seatingEventId}`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`${seatingOrigin}/rsvp/${seatingEventId}/extra`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`${seatingOrigin}/rsvp/KURZ`, seatingOrigin)).toBeNull()
    expect(parseSeatingUrl('kein link', seatingOrigin)).toBeNull()
    expect(parseSeatingUrl(`${seatingOrigin}/rsvp/${seatingEventId}`, null)).toBeNull()
  })

  it('originOf: Origin ohne Pfad, null bei Unsinn oder fremdem Schema', () => {
    expect(originOf('https://rsvp.example.test/')).toBe('https://rsvp.example.test')
    expect(originOf('http://127.0.0.1:2527/pfad')).toBe('http://127.0.0.1:2527')
    expect(originOf('javascript:alert(1)')).toBeNull()
    expect(originOf('kein url')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})

describe('readLimitedText', () => {
  it('liest bis zur Grenze, darüber null - auch ohne ehrliche Content-Length', async () => {
    expect(await readLimitedText(new Request('http://x.test', { method: 'POST', body: 'hallo' }), 10)).toBe('hallo')
    expect(await readLimitedText(new Request('http://x.test', { method: 'POST', body: 'x'.repeat(11) }), 10)).toBeNull()
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(8))); c.enqueue(new TextEncoder().encode('x'.repeat(8))); c.close() } })
    expect(await readLimitedText(new Request('http://x.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), 10)).toBeNull()
  })
})
