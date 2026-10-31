import { describe, expect, it } from 'vitest'
import {
  assertReconfirmAllowed, autoDeclinable, readReconfirmSettings, reconfirmForGuest, reconfirmPending, reconfirmRunning, reconfirmStatus, reconfirmWindow
} from '../../app/lib/reconfirm'
import { InputError } from '../../app/lib/input-error'

// Rückbestätigung vor dem Termin (Idee L30): Zeitraum, Frist, wer gefragt und wer automatisch abgesagt wird
const HOUR = 60 * 60 * 1000
const at = (iso: string) => new Date(iso)
// Samstag, 14.11.2026, 19:00 Berliner Zeit (UTC+1)
const start = at('2026-11-14T18:00:00Z')
const event = (overrides: Partial<{ reconfirmDays: number | null; datePending: boolean; reconfirmAutoDecline: boolean }> = {}) =>
  ({ date: start, datePending: false, reconfirmDays: 3, reconfirmAutoDecline: true, ...overrides })
const rsvp = (overrides: Partial<{ isAttending: boolean; isOnWaitlist: boolean; shiftHelperId: string | null; hasAttended: boolean; reconfirmAskedAt: Date | null; reconfirmedAt: Date | null; reconfirmLapsedAt: Date | null; amountCents: number | null }> = {}) =>
  ({ isAttending: true, isOnWaitlist: false, shiftHelperId: null, hasAttended: false, reconfirmAskedAt: null, reconfirmedAt: null, reconfirmLapsedAt: null, amountCents: null, ...overrides })
const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

describe('Zeitraum', () => {
  it('fragt ab X Tage vor Beginn, Frist 24 h vor Beginn', () => {
    expect(reconfirmWindow(event())).toEqual({ askFrom: at('2026-11-11T18:00:00Z'), deadline: at('2026-11-13T18:00:00Z') })
  })

  it('aus ohne Tage und solange das Datum noch abgestimmt wird', () => {
    expect(reconfirmWindow(event({ reconfirmDays: null }))).toBeNull()
    expect(reconfirmWindow(event({ datePending: true }))).toBeNull()
  })

  it('läuft vom Beginn des Zeitraums bis zum Beginn des Termins (bestätigen auch nach der Frist)', () => {
    expect(reconfirmRunning(event(), at('2026-11-11T17:59:59Z'))).toBe(false)
    expect(reconfirmRunning(event(), at('2026-11-11T18:00:00Z'))).toBe(true)
    expect(reconfirmRunning(event(), at('2026-11-14T17:00:00Z'))).toBe(true)
    expect(reconfirmRunning(event(), start)).toBe(false)
  })
})

describe('Wen es betrifft', () => {
  const now = at('2026-11-12T12:00:00Z')

  it('feste, zählende Zusagen ohne Bestätigung', () => {
    expect(reconfirmPending(event(), rsvp(), true, now)).toBe(true)
    expect(reconfirmPending(event(), rsvp({ reconfirmedAt: now }), true, now)).toBe(false)
    // nicht zählend (z. B. Adresse unbestätigt bei Pflicht), Helfer*innen aus Schichten, schon eingecheckt
    expect(reconfirmPending(event(), rsvp(), false, now)).toBe(false)
    expect(reconfirmPending(event(), rsvp({ shiftHelperId: 'h1' }), true, now)).toBe(false)
    expect(reconfirmPending(event(), rsvp({ hasAttended: true }), true, now)).toBe(false)
    // vor dem Zeitraum noch nicht
    expect(reconfirmPending(event(), rsvp(), true, at('2026-11-10T12:00:00Z'))).toBe(false)
  })

  it('Gästeseite: Kasten bleibt nach der Antwort eingehängt, Frist nur solange sie läuft', () => {
    expect(reconfirmForGuest(event(), null, true, now)).toBeNull()
    expect(reconfirmForGuest(event(), rsvp(), true, now)).toEqual({ pending: true, deadline: 'Fr., 13.11.2026, 19:00 Uhr', autoDecline: true })
    expect(reconfirmForGuest(event(), rsvp({ isAttending: false }), false, now)).toMatchObject({ pending: false })
    expect(reconfirmForGuest(event(), rsvp(), true, at('2026-11-14T08:00:00Z'))).toMatchObject({ pending: true, deadline: null })
  })
})

describe('Automatische Absage', () => {
  const deadline = at('2026-11-13T18:00:00Z')

  it('nur gefragte Zusagen mit mindestens 24 Stunden Zeit zum Antworten', () => {
    expect(autoDeclinable(rsvp(), deadline)).toBe(false)
    expect(autoDeclinable(rsvp({ reconfirmAskedAt: new Date(deadline.getTime() - 24 * HOUR) }), deadline)).toBe(true)
    expect(autoDeclinable(rsvp({ reconfirmAskedAt: new Date(deadline.getTime() - 23 * HOUR) }), deadline)).toBe(false)
  })

  it('nie mit Ticketpreis', () => {
    const asked = { reconfirmAskedAt: at('2026-11-11T18:00:00Z') }
    expect(autoDeclinable(rsvp({ ...asked, amountCents: 1500 }), deadline)).toBe(false)
    expect(autoDeclinable(rsvp({ ...asked, amountCents: 0 }), deadline)).toBe(true)
  })
})

describe('Stand für die Verwaltung', () => {
  const deadline = at('2026-11-13T18:00:00Z')

  it('offen bis zur Frist, danach unbestätigt; bestätigt; verfallen nach automatischer Absage', () => {
    expect(reconfirmStatus(event(), rsvp(), true, at('2026-11-10T12:00:00Z'))).toBeNull()
    expect(reconfirmStatus(event(), rsvp(), true, at('2026-11-12T12:00:00Z'))).toBe('open')
    expect(reconfirmStatus(event(), rsvp(), true, at('2026-11-14T12:00:00Z'))).toBe('unconfirmed')
    expect(reconfirmStatus(event(), rsvp({ reconfirmedAt: at('2026-11-12T12:00:00Z') }), true, at('2026-11-14T12:00:00Z'))).toBe('confirmed')
    expect(reconfirmStatus(event(), rsvp({ isAttending: false, reconfirmLapsedAt: deadline }), false, at('2026-11-14T12:00:00Z'))).toBe('lapsed')
    // eine neue Zusage nach dem Verfall zählt wieder normal
    expect(reconfirmStatus(event(), rsvp({ reconfirmLapsedAt: deadline }), true, at('2026-11-12T12:00:00Z'))).toBe('open')
  })
})

describe('Einstellungen', () => {
  it('ohne Marker unverändert, Haken aus = aus, Tage 2 bis 30', () => {
    expect(readReconfirmSettings(form({}))).toEqual({})
    expect(readReconfirmSettings(form({ reconfirmShown: '1', reconfirmDays: '5', reconfirmAutoDecline: 'on' }))).toEqual({ reconfirmDays: null, reconfirmAutoDecline: false })
    expect(readReconfirmSettings(form({ reconfirmShown: '1', reconfirm: 'on', reconfirmDays: '5' }))).toEqual({ reconfirmDays: 5, reconfirmAutoDecline: false })
    expect(readReconfirmSettings(form({ reconfirmShown: '1', reconfirm: 'on', reconfirmDays: '2', reconfirmAutoDecline: 'on' }))).toEqual({ reconfirmDays: 2, reconfirmAutoDecline: true })
    for (const days of ['1', '31', '2.5', '']) {
      expect(() => readReconfirmSettings(form({ reconfirmShown: '1', reconfirm: 'on', reconfirmDays: days }))).toThrow(InputError)
    }
  })

  it('nicht im Einladungsmodus', () => {
    expect(() => assertReconfirmAllowed(3, true)).toThrow(InputError)
    expect(() => assertReconfirmAllowed(null, true)).not.toThrow()
    expect(() => assertReconfirmAllowed(3, false)).not.toThrow()
  })
})
