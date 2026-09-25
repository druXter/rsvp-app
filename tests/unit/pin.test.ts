import { beforeEach, describe, expect, it, vi } from 'vitest'

// hasEventPinAccess liest das Freischalt-Cookie über next/headers - hier eine feste Liste.
let cookieJar: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined) })
}))
const participantFindUnique = vi.fn()
const rsvpFindUnique = vi.fn()
vi.mock('../../app/lib/prisma', () => ({
  prisma: { participant: { findUnique: participantFindUnique }, rsvp: { findUnique: rsvpFindUnique } }
}))

const { hasEventPinAccess, hasSeriesPinAccess, tokenBelongsToEvent } = await import('../../app/lib/pin')

beforeEach(() => {
  cookieJar = {}
  participantFindUnique.mockReset().mockResolvedValue(null)
  rsvpFindUnique.mockReset().mockResolvedValue(null)
})

describe('hasEventPinAccess', () => {
  it('ohne PIN immer frei', async () => {
    expect(await hasEventPinAccess({ id: 'e1', eventPin: null })).toBe(true)
  })

  it('Einzel-Event: nur mit dem Cookie genau dieses Events und der richtigen PIN', async () => {
    const event = { id: 'e1', eventPin: '4711' }
    expect(await hasEventPinAccess(event)).toBe(false)
    cookieJar = { event_pin_e1: '4712' }
    expect(await hasEventPinAccess(event)).toBe(false)
    cookieJar = { event_pin_e2: '4711' }
    expect(await hasEventPinAccess(event)).toBe(false)
    cookieJar = { event_pin_e1: '4711' }
    expect(await hasEventPinAccess(event)).toBe(true)
  })

  it('Reihen-Termin: die PIN der Reihe zählt, die des Termins ist wirkungslos', async () => {
    const locked = { id: 't1', eventPin: '0000', series: { id: 's1', eventPin: '1357' } }
    cookieJar = { event_pin_t1: '0000' }
    expect(await hasEventPinAccess(locked)).toBe(false)
    cookieJar = { series_pin_s1: '1357' }
    expect(await hasEventPinAccess(locked)).toBe(true)

    const openSeries = { id: 't2', eventPin: '0000', series: { id: 's2', eventPin: null } }
    cookieJar = {}
    expect(await hasEventPinAccess(openSeries)).toBe(true)
    expect(await hasSeriesPinAccess({ id: 's2', eventPin: null })).toBe(true)
  })
})

describe('tokenBelongsToEvent', () => {
  it('kein oder unbekannter Token: nein', async () => {
    expect(await tokenBelongsToEvent(null, { id: 'e1', seriesId: null })).toBe(false)
    expect(await tokenBelongsToEvent('unbekannt', { id: 'e1', seriesId: null })).toBe(false)
  })

  it('Reihe: nur ein Participant derselben Reihe', async () => {
    participantFindUnique.mockResolvedValue({ id: 'p1', seriesId: 's-andere' })
    expect(await tokenBelongsToEvent('tok', { id: 't1', seriesId: 's1' })).toBe(false)
    participantFindUnique.mockResolvedValue({ id: 'p1', seriesId: 's1' })
    expect(await tokenBelongsToEvent('tok', { id: 't1', seriesId: 's1' })).toBe(true)
  })

  it('Einzel-Event: nur wer zu genau diesem Event schon geantwortet hat', async () => {
    participantFindUnique.mockResolvedValue({ id: 'p1', seriesId: null })
    expect(await tokenBelongsToEvent('tok', { id: 'e1', seriesId: null })).toBe(false)
    rsvpFindUnique.mockResolvedValue({ id: 'r1' })
    expect(await tokenBelongsToEvent('tok', { id: 'e1', seriesId: null })).toBe(true)
    expect(rsvpFindUnique).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { eventId_participantId: { eventId: 'e1', participantId: 'p1' } }
    }))
  })
})
