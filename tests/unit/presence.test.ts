import { describe, expect, it } from 'vitest'
import { isPresent, presenceReport, presentPersons } from '../../app/lib/checkin'
import { formatPresenceTime } from '../../app/lib/presence-format'

// Kommen und Gehen (Idee L7): Aufenthalte aus dem Protokoll, wer gerade da ist, Uhrzeiten fürs Protokoll.
const at = (hhmm: string, day = '2026-10-15') => new Date(`${day}T${hhmm}:00+02:00`)
const e = (name: string, kind: 'IN' | 'OUT', hhmm: string, position: number | null = null, rsvpId = name) => ({ rsvpId, position, name, kind, at: at(hhmm) })

describe('presenceReport', () => {
  it('Aufenthalte pro Person, offen = noch da, sortiert nach erstem Kommen', () => {
    const report = presenceReport([
      e('Ben', 'IN', '19:05'), e('Anna', 'IN', '19:00'), e('Ben', 'OUT', '20:15'), e('Ben', 'IN', '20:40'), e('Anna', 'OUT', '21:00')
    ])
    expect(report.rows.map(r => [r.name, r.present, r.stays.map(s => [s.from, s.to])])).toEqual([
      ['Anna', false, [[at('19:00'), at('21:00')]]],
      ['Ben', true, [[at('19:05'), at('20:15')], [at('20:40'), null]]]
    ])
    expect(report.presentCount).toBe(1)
    expect(report.timeline.map(x => `${x.name}:${x.kind}`)).toEqual(['Anna:IN', 'Ben:IN', 'Ben:OUT', 'Ben:IN', 'Anna:OUT'])
  })

  it('Personen einer Antwort getrennt, der letzte Name zählt, doppelte Wechsel werden ignoriert', () => {
    const report = presenceReport([
      e('Anna', 'IN', '19:00', 0, 'r1'), e('Begleitung', 'IN', '19:00', 1, 'r1'), e('Bea', 'OUT', '20:00', 1, 'r1'), e('Bea', 'OUT', '20:05', 1, 'r1'),
      e('Anna', 'IN', '19:30', 0, 'r1'), e('Gast', 'OUT', '18:00', null, 'r2')
    ])
    expect(report.rows.map(r => [r.name, r.stays.length, r.present])).toEqual([['Anna', 1, true], ['Bea', 1, false]])
  })
})

describe('Wer ist da', () => {
  it('isPresent: eingecheckt und nicht gegangen', () => {
    expect(isPresent({ hasAttended: true, leftAt: null })).toBe(true)
    expect(isPresent({ hasAttended: true, leftAt: new Date() })).toBe(false)
    expect(isPresent({ hasAttended: false })).toBe(false)
    expect(isPresent({ checkedInAt: new Date(), leftAt: null }, true)).toBe(true)
    expect(isPresent({ checkedInAt: null }, true)).toBe(false)
  })

  it('presentPersons: nur feste Plätze, Personen einzeln', () => {
    const now = new Date()
    expect(presentPersons([
      { isAttending: true, isOnWaitlist: false, hasAttended: true, leftAt: null },
      { isAttending: true, isOnWaitlist: false, hasAttended: true, leftAt: now },
      { isAttending: true, isOnWaitlist: true, hasAttended: true },
      { isAttending: true, isOnWaitlist: false, hasAttended: true, persons: [
        { isAttending: true, checkedInAt: now, leftAt: null }, { isAttending: true, checkedInAt: now, leftAt: now }, { isAttending: true, checkedInAt: null }
      ] }
    ])).toBe(2)
  })
})

describe('formatPresenceTime', () => {
  it('am Tag des Termins nur die Uhrzeit, sonst mit Datum (Zeitzone Berlin)', () => {
    expect(formatPresenceTime(at('20:15'), at('19:00'))).toBe('20:15')
    expect(formatPresenceTime(at('00:30', '2026-10-16'), at('19:00'))).toBe('16.10. 00:30')
  })
})
