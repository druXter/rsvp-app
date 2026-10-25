import { describe, expect, it } from 'vitest'
import { EVENT_PRESETS, presetOf, slugify } from '../../app/lib/event-presets'
import { isPastEvent, summarizeEvent } from '../../app/lib/event-summary'

describe('Neues Event: Arten und URL-Wort', () => {
  it('slugify: Umlaute ausgeschrieben, nur a-z/0-9/-, höchstens 60 Zeichen, nie leer', () => {
    expect(slugify('Annas 30. Geburtstag!')).toBe('annas-30-geburtstag')
    expect(slugify('Hochzeit Lena & Max')).toBe('hochzeit-lena-max')
    expect(slugify('Grüße aus Köln, Straße')).toBe('gruesse-aus-koeln-strasse')
    expect(slugify('Café Crème')).toBe('cafe-creme')
    expect(slugify('!!!')).toBe('event')
    expect(slugify('x'.repeat(80))).toHaveLength(60)
    expect(slugify(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59))
  })

  it('presetOf: unbekannt = offene Anmeldung; Hochzeit nur mit Einladung, Ball mit Einlass', () => {
    expect(presetOf('hochzeit')).toBe('hochzeit')
    expect(presetOf('toString')).toBe('offen')
    expect(presetOf(undefined)).toBe('offen')
    expect(EVENT_PRESETS.hochzeit).toMatchObject({ inviteOnly: true, next: { tab: 'einladungen' } })
    expect(EVENT_PRESETS.ball).toMatchObject({ enableCheckin: true, next: { tab: 'einstellungen', section: 'tickets' } })
  })
})

describe('Kennzahlen eines Events', () => {
  const base = { isAttending: true, isOnWaitlist: false, hasAttended: false, amountCents: null, paidAt: null, refundedAt: null, paymentDueAt: null }
  const now = new Date('2026-10-10T12:00:00Z')

  it('zählt Zusagen, Plätze (Personen ohne Kleinkinder), Warteliste, Absagen, Einlass, Zahlungen und offene Einladungen', () => {
    const s = summarizeEvent([
      { ...base, hasAttended: true, persons: [{ isAttending: true, ageGroup: 'ADULT', checkedInAt: now }, { isAttending: true, ageGroup: 'INFANT', checkedInAt: now }, { isAttending: true, ageGroup: 'CHILD' }, { isAttending: false, ageGroup: 'ADULT' }] },
      // Ohne Personenliste zählt der Haken der Antwort
      { ...base, hasAttended: true },
      { ...base, amountCents: 2500, paymentDueAt: new Date('2026-10-01T00:00:00Z') },
      { ...base, amountCents: 3000, paidAt: now },
      { ...base, isOnWaitlist: true, amountCents: 2500 },
      { ...base, isAttending: false }
    ], 8, now)
    expect(s).toEqual({
      confirmed: 4, seats: 5, waitlist: 1, declined: 1, maybe: 0, checkedIn: 3, attendees: 6,
      paymentsOpen: 1, paymentsOverdue: 1, openCents: 2500, paidCents: 3000, invitationsOpen: 2
    })
    expect(summarizeEvent([], null).invitationsOpen).toBeNull()
  })

  it('„Vielleicht“ zählt eigens, nicht als Absage (app/lib/maybe.ts)', () => {
    const s = summarizeEvent([{ ...base, isAttending: false, isMaybe: true }, { ...base, isAttending: false }, { ...base, isAttending: false, isMaybe: true }], null, now)
    expect([s.confirmed, s.declined, s.maybe]).toEqual([0, 1, 2])
  })

  it('vergangen erst nach dem Ende, offenes Datum nie', () => {
    const start = new Date('2026-10-10T08:00:00Z')
    expect(isPastEvent({ date: start, duration: 4, datePending: false }, now)).toBe(false)
    expect(isPastEvent({ date: start, duration: 3, datePending: false }, now)).toBe(true)
    expect(isPastEvent({ date: start, duration: 3, datePending: true }, now)).toBe(false)
  })
})
