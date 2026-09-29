import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_DEFINITIONS, configuredTool, openMessage, resolveToolSecret, toolDefinition } from '../../app/lib/linked-tools'
import { createTimelineLink, timelineLinkOf, timelineRsvpChange } from '../../app/lib/timeline'

// Vertrag mit dem Zeitplan-Tool (app/lib/timeline.ts, Gegenstück dort app/lib/rsvp/token.ts). Die
// beiden festen Nachrichten unten hat Zeitplans createMessage mit genau diesen Werten erzeugt - sie
// prüfen, dass beide Seiten dasselbe Format sprechen, nicht nur diese Implementierung gegen sich selbst.
const secret = 'test-timeline-secret-0123456789abcdef012'
const zeitplan = 'https://zeitplan.example.test'
const now = new Date('2026-10-01T12:00:00Z')
const timelineEventId = 'cmtimelineevent0001'
const rsvpEventId = 'cmrsvpevent00000001'
const rsvpId = 'cmrsvpanswer0000001'
const link = { type: 'timeline', url: `${zeitplan}/rsvp/${timelineEventId}`, origin: zeitplan, remoteEventId: timelineEventId }

const ZEITPLAN_TIMELINE_LINK =
  'eyJ0eXAiOiJ0aW1lbGluZS1saW5rIiwiYXVkIjoiaHR0cHM6Ly96ZWl0cGxhbi5leGFtcGxlLnRlc3QiLCJ0aW1lbGluZUV2ZW50SWQiOiJjbXRpbWVsaW5lZXZlbnQwMDAxIiwicnN2cEV2ZW50SWQiOiJjbXJzdnBldmVudDAwMDAwMDAxIiwicnN2cElkIjoiY21yc3ZwYW5zd2VyMDAwMDAwMSIsImlhdCI6MTc5MDg1NjAwMCwiZXhwIjoxNzkwODU2NjAwfQ.hAu1F3y3KMGC64pN4U45bkiXweVo80vQJnQ1NGu6brM'
const ZEITPLAN_RSVP_CHANGE =
  'eyJ0eXAiOiJyc3ZwLWNoYW5nZSIsImF1ZCI6Imh0dHBzOi8vemVpdHBsYW4uZXhhbXBsZS50ZXN0IiwidGltZWxpbmVFdmVudElkIjoiY210aW1lbGluZWV2ZW50MDAwMSIsInJzdnBFdmVudElkIjoiY21yc3ZwZXZlbnQwMDAwMDAwMSIsInJzdnBJZCI6ImNtcnN2cGFuc3dlcjAwMDAwMDEiLCJhdHRlbmRpbmciOmZhbHNlLCJpYXQiOjE3OTA4NTYwMDAsImV4cCI6MTc5MDg1NjYwMH0.GaI8u6CCzhN8G5OMTcem5WAuTSU0rP5zN1od_lvNSN4'

const change = (rsvp: { isAttending: boolean; isOnWaitlist: boolean }, extra: { isVerified?: boolean; requireVerification?: boolean; deleted?: boolean } = {}) =>
  openMessage(timelineRsvpChange({
    link, secret, rsvpEventId, rsvp: { id: rsvpId, ...rsvp },
    participant: { isVerified: extra.isVerified ?? true }, requireVerification: extra.requireVerification ?? false, deleted: extra.deleted ?? false
  }), secret) as Record<string, unknown>

describe('Vertrag mit Zeitplan', () => {
  it('Tool-Definition wie im Vertrag', () => {
    expect(toolDefinition('timeline')).toMatchObject({
      label: 'Zeitplan', linkLabel: 'Zeitplan-Link', secretEnv: 'TIMELINE_SECRET', baseUrlEnv: 'TIMELINE_BASE_URL',
      linkSegment: 'rsvp', remoteIdField: 'timelineEventId', webhookPath: '/api/rsvp-webhook'
    })
  })

  it('timeline-link byte-gleich zu dem von Zeitplan, 10 Minuten gültig', () => {
    expect(createTimelineLink({ link, rsvpEventId, rsvpId }, secret, { now })).toBe(ZEITPLAN_TIMELINE_LINK)
    expect(openMessage(ZEITPLAN_TIMELINE_LINK, secret)).toEqual({
      typ: 'timeline-link', aud: zeitplan, timelineEventId, rsvpEventId, rsvpId, iat: 1790856000, exp: 1790856600
    })
  })

  it('rsvp-change byte-gleich zu dem von Zeitplan - nur Kennungen und attending, keine Namen oder Adressen', () => {
    vi.useFakeTimers({ now })
    const body = timelineRsvpChange({
      link, secret, rsvpEventId, rsvp: { id: rsvpId, isAttending: false, isOnWaitlist: false },
      participant: { isVerified: true }, requireVerification: false, deleted: false
    })
    vi.useRealTimers()
    expect(body).toBe(ZEITPLAN_RSVP_CHANGE)
    expect(Object.keys(openMessage(body, secret) as object)).toEqual(
      ['typ', 'aud', 'timelineEventId', 'rsvpEventId', 'rsvpId', 'attending', 'iat', 'exp']
    )
  })

  it('attending: nur zugesagt, nicht Warteliste, bei Double-Opt-In verifiziert, nie nach dem Löschen', () => {
    expect(change({ isAttending: true, isOnWaitlist: false }).attending).toBe(true)
    expect(change({ isAttending: false, isOnWaitlist: false }).attending).toBe(false)
    expect(change({ isAttending: true, isOnWaitlist: true }).attending).toBe(false)
    expect(change({ isAttending: true, isOnWaitlist: false }, { isVerified: false, requireVerification: true }).attending).toBe(false)
    expect(change({ isAttending: true, isOnWaitlist: false }, { isVerified: false, requireVerification: false }).attending).toBe(true)
    expect(change({ isAttending: true, isOnWaitlist: false }, { deleted: true }).attending).toBe(false)
  })

  it('mit einem anderen Secret (z.B. dem von Seating) nicht lesbar', () => {
    expect(openMessage(ZEITPLAN_TIMELINE_LINK, 'seating-secret-0123456789abcdef0123456')).toBeNull()
  })
})

describe('Konfiguration', () => {
  const saved = { ...process.env }
  const seatingSecret = 'seating-secret-0123456789abcdef0123456'
  beforeEach(() => {
    process.env.BASE_URL = 'https://rsvp.example.test'
    process.env.TIMELINE_SECRET = secret
    process.env.TIMELINE_BASE_URL = `${zeitplan}/`
    process.env.SEATING_SECRET = seatingSecret
    process.env.SEATING_BASE_URL = 'https://plaetze.example.test'
    process.env.POLL_VERIFICATION_SECRET = 'poll-secret-0123456789abcdef0123456789'
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('TIMELINE_SECRET/TIMELINE_BASE_URL richten das Tool ein, unabhängig von Seating', () => {
    expect(configuredTool('timeline')).toMatchObject({ secret, origin: zeitplan })
    expect(configuredTool('seating')).toMatchObject({ secret: seatingSecret })
    delete process.env.TIMELINE_BASE_URL
    expect(configuredTool('timeline')).toBeNull()
    expect(configuredTool('seating')).not.toBeNull()
  })

  it('dasselbe Secret wie Seating: Zeitplan UND Seating aus', () => {
    process.env.TIMELINE_SECRET = seatingSecret
    for (const d of TOOL_DEFINITIONS) expect(resolveToolSecret(d), d.type).toBeNull()
  })

  it('Zeitplan-Link nur mit dem Origin von TIMELINE_BASE_URL und der Form /rsvp/<id>', () => {
    const event = (url: string) => ({ id: rsvpEventId, toolLinks: [{ type: 'timeline', url, remoteEventId: timelineEventId }] })
    expect(timelineLinkOf(event(link.url))).toMatchObject({ origin: zeitplan, remoteEventId: timelineEventId })
    expect(timelineLinkOf(event(`https://plaetze.example.test/rsvp/${timelineEventId}`))).toBeNull()
    expect(timelineLinkOf(event(`${zeitplan}/e/${timelineEventId}`))).toBeNull()
    // Ein Seating-Link desselben Termins ist kein Zeitplan-Link
    expect(timelineLinkOf({ id: rsvpEventId, toolLinks: [{ ...link, type: 'seating' }] })).toBeNull()
  })
})
