import { describe, expect, it } from 'vitest'
import { createInfoPageLink, infoPageRsvpChange } from '../../app/lib/infopage'

// Vertrag mit der Startseite (Idee L38): feste Prüfnachrichten - dieselben stehen bei der Startseite
// (tests/unit/guest.test.ts). Ändert sich das Format, auf BEIDEN Seiten neu erzeugen und gemeinsam ausrollen.
const SECRET = 'pruefnachricht-startseite-rsvp-secret-0123456789'
const NOW = new Date('2026-11-01T10:00:00Z')
const LINK = { type: 'infopage', url: 'https://startseite.example/rsvp/cmpage00000000001', origin: 'https://startseite.example', remoteEventId: 'cmpage00000000001' }
const EXPECTED_LINK = 'eyJ0eXAiOiJpbmZvLXBhZ2UtbGluayIsImF1ZCI6Imh0dHBzOi8vc3RhcnRzZWl0ZS5leGFtcGxlIiwicGFnZUlkIjoiY21wYWdlMDAwMDAwMDAwMDEiLCJyc3ZwRXZlbnRJZCI6ImNtcnN2cGV2ZW50MDAwMDAxIiwicnN2cElkIjoiY21yc3ZwenVzYWdlMDAwMDEiLCJpYXQiOjE3OTM1MjcyMDAsImV4cCI6MTc5MzUyNzgwMH0.dpL326QPTxhMGKQWhIQXB1mNMlqvzgWug4kJ0_VKXwo'
const EXPECTED_CHANGE = 'eyJ0eXAiOiJyc3ZwLWNoYW5nZSIsImF1ZCI6Imh0dHBzOi8vc3RhcnRzZWl0ZS5leGFtcGxlIiwicGFnZUlkIjoiY21wYWdlMDAwMDAwMDAwMDEiLCJyc3ZwRXZlbnRJZCI6ImNtcnN2cGV2ZW50MDAwMDAxIiwicnN2cElkIjoiY21yc3ZwenVzYWdlMDAwMDEiLCJhdHRlbmRpbmciOmZhbHNlLCJpYXQiOjE3OTM1MjcyMDAsImV4cCI6MTc5MzUyNzgwMH0.TwPGqZKPLHQW3kpZJaju0r2cOB1wXZ81nqhLS-PntXk'

describe('Vertrag mit der Startseite', () => {
  it('Link „Infos für Gäste“ wie bei der Startseite erwartet', () => {
    expect(createInfoPageLink({ link: LINK, rsvpEventId: 'cmrsvpevent000001', rsvpId: 'cmrsvpzusage00001' }, SECRET, { now: NOW })).toBe(EXPECTED_LINK)
  })

  it('Webhook bei Absage: attending false, nur Kennungen', () => {
    const body = infoPageRsvpChange({
      link: LINK, secret: SECRET, rsvpEventId: 'cmrsvpevent000001',
      rsvp: { id: 'cmrsvpzusage00001', isAttending: false, isOnWaitlist: false }, participant: { isVerified: true }, requireVerification: false, deleted: false
    }, { now: NOW })
    expect(body).toBe(EXPECTED_CHANGE)
    expect(Buffer.from(body.split('.')[0], 'base64url').toString()).not.toMatch(/name|mail/i)
  })
})
