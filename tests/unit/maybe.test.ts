import { describe, expect, it } from 'vitest'
import {
  checkMaybeReminder, defaultMaybeReminder, effectiveAllowMaybe, hasOpenMaybe, latestMaybeReminder, maybeAvailable, maybeCutoff, maybeForForm,
  maybeStatusLabel, nextFullHour
} from '../../app/lib/maybe'
import { berlinDateTimeInputValue, parseBerlinDateTime, parseDeadline } from '../../app/lib/rsvp-deadline'

// Antwort „Vielleicht“ (docs/KONZEPT-VIELLEICHT.md): Stichtag, Erinnerungszeitpunkt, Anzeige
const at = (iso: string) => new Date(iso)
// Samstag, 14.11.2026, 19:00 Berliner Zeit (Winterzeit, UTC+1)
const start = at('2026-11-14T18:00:00Z')
const event = (overrides: Partial<{ date: Date; datePending: boolean; rsvpDeadline: Date | null; allowMaybe: boolean; maxCapacity: number | null }> = {}) =>
  ({ date: start, datePending: false, rsvpDeadline: null, allowMaybe: true, series: null, maxCapacity: null, ...overrides })

describe('Stichtag und spätester Erinnerungszeitpunkt', () => {
  it('ohne Antwortfrist 12 h vor Beginn, Erinnerung spätestens 24 h davor (volle Stunde)', () => {
    expect(maybeCutoff(event())).toEqual(at('2026-11-14T06:00:00Z'))
    expect(latestMaybeReminder(event())).toEqual(at('2026-11-13T06:00:00Z'))
  })

  it('mit Antwortfrist die frühere der beiden: Frist (Ende des Tages) oder Beginn − 12 h', () => {
    const deadline = parseDeadline('2026-11-10')!
    expect(maybeCutoff(event({ rsvpDeadline: deadline }))).toEqual(deadline)
    // 23:59:59 am 10.11. -> Erinnerung spätestens 22:00 Uhr Berliner Zeit am 9.11. (abgerundet)
    expect(latestMaybeReminder(event({ rsvpDeadline: deadline }))).toEqual(at('2026-11-09T22:00:00Z'))
    // Frist am Tag des Events (23:59, nach Beginn): dann gilt Beginn − 12 h
    expect(maybeCutoff(event({ rsvpDeadline: parseDeadline('2026-11-14') }))).toEqual(at('2026-11-14T06:00:00Z'))
  })

  it('Datum offen (Terminabstimmung): nur die Antwortfrist, ohne sie gibt es noch keinen Stichtag', () => {
    expect(maybeCutoff(event({ datePending: true }))).toBeNull()
    expect(latestMaybeReminder(event({ datePending: true }))).toBeNull()
    expect(maybeCutoff(event({ datePending: true, rsvpDeadline: parseDeadline('2026-11-10') }))).toEqual(parseDeadline('2026-11-10'))
  })
})

describe('Wann „Vielleicht“ wählbar ist', () => {
  it('nur wenn erlaubt - bei Reihen-Terminen zählt die Reihe', () => {
    expect(effectiveAllowMaybe({ allowMaybe: false, series: { allowMaybe: true } })).toBe(true)
    expect(effectiveAllowMaybe({ allowMaybe: true, series: { allowMaybe: false } })).toBe(false)
    expect(maybeAvailable(event({ allowMaybe: false }), at('2026-11-01T12:00:00Z'))).toBe(false)
  })

  it('solange noch eine volle Stunde für die Erinnerung frei ist', () => {
    expect(nextFullHour(at('2026-11-13T05:00:00Z'))).toEqual(at('2026-11-13T06:00:00Z'))
    expect(maybeAvailable(event(), at('2026-11-13T05:59:00Z'))).toBe(true)
    expect(maybeAvailable(event(), at('2026-11-13T06:00:00Z'))).toBe(false)
    expect(maybeAvailable(event({ datePending: true }), at('2027-06-01T00:00:00Z'))).toBe(true)
  })
})

describe('Gewählter Erinnerungszeitpunkt', () => {
  const now = at('2026-11-01T12:30:00Z')

  it('wird auf die volle Stunde abgerundet und muss in der Zukunft liegen', () => {
    expect(checkMaybeReminder(event(), at('2026-11-05T17:45:00Z'), now)).toEqual({ remindAt: at('2026-11-05T17:00:00Z') })
    expect(checkMaybeReminder(event(), at('2026-11-01T12:45:00Z'), now)).toMatchObject({ error: expect.stringContaining('Zukunft') })
    expect(checkMaybeReminder(event(), null, now)).toMatchObject({ error: expect.stringContaining('erinnern') })
    expect(checkMaybeReminder(event(), new Date('kaputt'), now)).toMatchObject({ error: expect.stringContaining('erinnern') })
  })

  it('höchstens 24 h vor dem Stichtag - Grenze genau erlaubt, eine Stunde später nicht', () => {
    expect(checkMaybeReminder(event(), at('2026-11-13T06:00:00Z'), now)).toEqual({ remindAt: at('2026-11-13T06:00:00Z') })
    expect(checkMaybeReminder(event(), at('2026-11-13T07:00:00Z'), now)).toMatchObject({ error: expect.stringContaining('24 Stunden vor dem Stichtag') })
  })

  it('Vorschlag fürs Formular: der späteste Zeitpunkt, ohne Grenze in einer Woche', () => {
    expect(defaultMaybeReminder(event(), now)).toEqual(at('2026-11-13T06:00:00Z'))
    expect(defaultMaybeReminder(event({ datePending: true }), now)).toEqual(at('2026-11-08T12:00:00Z'))
  })

  it('Formular: Grenzen in Berliner Zeit, eine passende eigene Erinnerung bleibt vorbelegt', () => {
    expect(maybeForForm(event({ maxCapacity: 20 }), null, now)).toEqual({
      min: '2026-11-01T14:00', max: '2026-11-13T07:00', value: '2026-11-13T07:00', cutoff: 'Sa., 14.11.2026, 07:00 Uhr', capacity: true
    })
    expect(maybeForForm(event(), { maybeRemindAt: at('2026-11-05T17:00:00Z') }, now)?.value).toBe('2026-11-05T18:00')
    // Liegt die eigene Erinnerung nicht mehr im erlaubten Bereich, kommt der Vorschlag
    expect(maybeForForm(event(), { maybeRemindAt: at('2026-11-13T08:00:00Z') }, now)?.value).toBe('2026-11-13T07:00')
    expect(maybeForForm(event({ allowMaybe: false }), null, now)).toBeNull()
  })
})

describe('Berliner Ortszeit im datetime-local-Feld', () => {
  it('Sommer- und Winterzeit, unabhängig von der Zeitzone des Servers', () => {
    expect(parseBerlinDateTime('2026-07-01T18:00')).toEqual(at('2026-07-01T16:00:00Z'))
    expect(parseBerlinDateTime('2026-12-01T18:00')).toEqual(at('2026-12-01T17:00:00Z'))
    // Tag der Umstellung (25.10.2026, 3 Uhr Sommerzeit -> 2 Uhr Winterzeit)
    expect(parseBerlinDateTime('2026-10-25T12:00')).toEqual(at('2026-10-25T11:00:00Z'))
    expect(berlinDateTimeInputValue(at('2026-07-01T16:00:00Z'))).toBe('2026-07-01T18:00')
    expect(berlinDateTimeInputValue(at('2026-12-01T17:00:00Z'))).toBe('2026-12-01T18:00')
  })

  it('Unsinn ergibt null', () => {
    for (const value of ['', '2026-02-30T10:00', '2026-11-01T25:00', '2026-11-01', 'morgen']) expect(parseBerlinDateTime(value), value).toBeNull()
  })
})

describe('Stand in der Gästeliste', () => {
  it('ohne bestätigte Adresse keine Erinnerung, sonst Zeitpunkt bzw. schon erinnert', () => {
    const remindAt = at('2026-11-05T17:00:00Z')
    expect(maybeStatusLabel({ maybeRemindAt: remindAt, maybeRemindedAt: null }, { email: 'a@example.org', isVerified: false })).toBe('Mail nicht bestätigt')
    expect(maybeStatusLabel({ maybeRemindAt: remindAt, maybeRemindedAt: null }, { email: null, isVerified: true })).toBe('Mail nicht bestätigt')
    expect(maybeStatusLabel({ maybeRemindAt: remindAt, maybeRemindedAt: null }, { email: 'a@example.org', isVerified: true })).toBe('Erinnerung Do., 05.11.2026, 18:00 Uhr')
    expect(maybeStatusLabel({ maybeRemindAt: remindAt, maybeRemindedAt: remindAt }, { email: 'a@example.org', isVerified: true })).toBe('erinnert am Do., 05.11.2026, 18:00 Uhr')
  })

  it('offen ist die ganze Antwort oder eine Person des Haushalts', () => {
    expect(hasOpenMaybe({ isMaybe: true })).toBe(true)
    expect(hasOpenMaybe({ isMaybe: false, persons: [{ isMaybe: false }, { isMaybe: true }] })).toBe(true)
    expect(hasOpenMaybe({ isMaybe: false, persons: [] })).toBe(false)
  })
})
