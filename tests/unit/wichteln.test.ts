import { describe, expect, it } from 'vitest'
import { createGuestsReply, verifyGuestsRequest, wichtelnGuestOf, wichtelnRsvpChange } from '../../app/lib/wichteln'

// Vertrag mit Wichteln (app/lib/wichteln.ts). Dieselben festen Nachrichten prüft Wichteln in tests/unit/rsvp-token.test.ts -
// so sprechen beide Seiten dasselbe Format, nicht nur diese Implementierung mit sich.
const secret = 'test-wichteln-secret-0123456789abcdef0123'
const now = new Date('2026-12-01T12:00:00Z')
const RSVP = 'https://rsvp.example.test'
const WICHTELN = 'https://wichteln.example.test'
const ids = { wichtelnEventId: 'cmwichtelevent0001', rsvpEventId: 'cmrsvpevent00000001' }

const REQUEST = 'eyJ0eXAiOiJ3aWNodGVsLWd1ZXN0cy1yZXF1ZXN0IiwiYXVkIjoiaHR0cHM6Ly9yc3ZwLmV4YW1wbGUudGVzdCIsIndpY2h0ZWxuRXZlbnRJZCI6ImNtd2ljaHRlbGV2ZW50MDAwMSIsInJzdnBFdmVudElkIjoiY21yc3ZwZXZlbnQwMDAwMDAwMSIsImlhdCI6MTc5NjEyNjQwMCwiZXhwIjoxNzk2MTI3MDAwfQ.Eqii8Zil5GboBkTm-lOe5QTA8AquwHVpb4erSn0HA-o'
const GUESTS = 'eyJ0eXAiOiJ3aWNodGVsLWd1ZXN0cyIsImF1ZCI6Imh0dHBzOi8vd2ljaHRlbG4uZXhhbXBsZS50ZXN0Iiwid2ljaHRlbG5FdmVudElkIjoiY213aWNodGVsZXZlbnQwMDAxIiwicnN2cEV2ZW50SWQiOiJjbXJzdnBldmVudDAwMDAwMDAxIiwiZ3Vlc3RzIjpbeyJyc3ZwSWQiOiJjbXJzdnBhbm5hMDAwMDAwMDEiLCJuYW1lIjoiQW5uYSIsImVtYWlsIjoiYW5uYUBleGFtcGxlLnRlc3QifV0sImlhdCI6MTc5NjEyNjQwMCwiZXhwIjoxNzk2MTI2NzAwfQ.UAwlpgCp_J-1OoYolo7_4a1Mi8EPrBjDhn2EScr-bvs'
const CHANGE = 'eyJ0eXAiOiJyc3ZwLWNoYW5nZSIsImF1ZCI6Imh0dHBzOi8vd2ljaHRlbG4uZXhhbXBsZS50ZXN0Iiwid2ljaHRlbG5FdmVudElkIjoiY213aWNodGVsZXZlbnQwMDAxIiwicnN2cEV2ZW50SWQiOiJjbXJzdnBldmVudDAwMDAwMDAxIiwiaWF0IjoxNzk2MTI2NDAwLCJleHAiOjE3OTYxMjcwMDB9.2uE_YWKrcp2OS1wwi54Zlk5T4TvHbkZ6CdZbcmaiT00'

describe('wichtel-guests-request', () => {
  it('liest die feste Anfrage von Wichteln', () => {
    expect(verifyGuestsRequest(REQUEST, { secret, audience: RSVP, now })).toEqual(ids)
  })

  it('lehnt falsches Secret, falschen Empfänger, andere Arten und Ablauf ab', () => {
    expect(verifyGuestsRequest(REQUEST, { secret: 'x'.repeat(40), audience: RSVP, now })).toBeNull()
    expect(verifyGuestsRequest(REQUEST, { secret, audience: WICHTELN, now })).toBeNull()
    expect(verifyGuestsRequest(CHANGE, { secret, audience: WICHTELN, now })).toBeNull()
    expect(verifyGuestsRequest(REQUEST, { secret, audience: RSVP, now: new Date('2026-12-01T12:10:01Z') })).toBeNull()
  })
})

describe('wichtel-guests und rsvp-change', () => {
  it('feste Antworten wie in Wichteln', () => {
    expect(createGuestsReply({ aud: WICHTELN, ...ids, guests: [{ rsvpId: 'cmrsvpanna00000001', name: 'Anna', email: 'anna@example.test' }] }, secret, now)).toBe(GUESTS)
    const link = { type: 'wichteln', url: `${WICHTELN}/rsvp/${ids.wichtelnEventId}`, origin: WICHTELN, remoteEventId: ids.wichtelnEventId }
    expect(wichtelnRsvpChange({ link, secret, rsvpEventId: ids.rsvpEventId, now })).toBe(CHANGE)
  })
})

describe('wichtelnGuestOf', () => {
  const rsvp = { id: 'r1', isAttending: true, isOnWaitlist: false }
  const participant = { name: ' Anna ', email: 'Anna@Example.test', isVerified: false }

  it('Zusage mit Adresse zählt, Adresse klein, Name ohne Leerraum', () => {
    expect(wichtelnGuestOf(rsvp, participant, false)).toEqual({ rsvpId: 'r1', name: 'Anna', email: 'anna@example.test' })
  })

  it('nicht ohne Zusage, auf der Warteliste, ohne Adresse oder unbestätigt bei Bestätigungspflicht', () => {
    expect(wichtelnGuestOf({ ...rsvp, isAttending: false }, participant, false)).toBeNull()
    expect(wichtelnGuestOf({ ...rsvp, isOnWaitlist: true }, participant, false)).toBeNull()
    expect(wichtelnGuestOf(rsvp, { ...participant, email: null }, false)).toBeNull()
    expect(wichtelnGuestOf(rsvp, participant, true)).toBeNull()
    expect(wichtelnGuestOf(rsvp, { ...participant, isVerified: true }, true)).not.toBeNull()
  })
})
