import { describe, expect, it } from 'vitest'
import { eventEndsAt, parsePhotoUrl, photoLinkVisible, PHOTO_URL_MAX_LENGTH } from '../../app/lib/photo-link'

describe('parsePhotoUrl', () => {
  it('leer ist kein Link, gültige http(s)-Adressen bleiben erhalten', () => {
    expect(parsePhotoUrl('')).toBeNull()
    expect(parsePhotoUrl('   ')).toBeNull()
    expect(parsePhotoUrl(' https://fotos.example.de/s/hochzeit ')).toBe('https://fotos.example.de/s/hochzeit')
    expect(parsePhotoUrl('http://192.168.1.5:2283/share/abc?key=x')).toBe('http://192.168.1.5:2283/share/abc?key=x')
  })

  it('lehnt andere Schemata und Unsinn ab (der Link wird zum href)', () => {
    for (const input of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'mailto:a@b.de', 'fotos.example.de', '//fotos.example.de']) {
      expect(() => parsePhotoUrl(input), input).toThrow()
    }
    expect(() => parsePhotoUrl(`https://example.de/${'a'.repeat(PHOTO_URL_MAX_LENGTH)}`)).toThrow('zu lang')
  })
})

describe('photoLinkVisible', () => {
  const date = new Date('2026-10-10T14:00:00Z')
  const event = { photoUrl: 'https://fotos.example.de/s/x', date, duration: 6, datePending: false }
  const yes = { isAttending: true, isOnWaitlist: false }
  const end = eventEndsAt(event)

  it('Ende = Beginn + Dauer in Stunden', () => {
    expect(end.toISOString()).toBe('2026-10-10T20:00:00.000Z')
  })

  it('erst ab Eventende und nur mit Zusage', () => {
    expect(photoLinkVisible(event, yes, new Date(end.getTime() - 1))).toBe(false)
    expect(photoLinkVisible(event, yes, end)).toBe(true)
    expect(photoLinkVisible(event, yes, new Date('2027-01-01T00:00:00Z'))).toBe(true)
  })

  it('nie ohne Zusage, auf der Warteliste, ohne Link oder mit offenem Datum', () => {
    const later = new Date('2026-10-11T00:00:00Z')
    expect(photoLinkVisible(event, null, later)).toBe(false)
    expect(photoLinkVisible(event, { isAttending: false, isOnWaitlist: false }, later)).toBe(false)
    expect(photoLinkVisible(event, { isAttending: true, isOnWaitlist: true }, later)).toBe(false)
    expect(photoLinkVisible({ ...event, photoUrl: null }, yes, later)).toBe(false)
    expect(photoLinkVisible({ ...event, datePending: true }, yes, later)).toBe(false)
  })
})
