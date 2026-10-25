import { describe, expect, it } from 'vitest'
import { buildEventIcs, foldIcs, icsUid } from '../../app/lib/ics'

// Kalenderdatei (app/lib/ics.ts): Ende als DTEND (iOS liest DURATION aus einem Mail-Anhang nicht), stabile UID.

const event = { id: 'cmevent0000000001', title: 'Biernachten 2026', location: 'Koblenzer Str 64, 56073 Koblenz', date: new Date('2026-12-23T17:00:00Z'), duration: 5, icsSequence: 2 }

describe('buildEventIcs', () => {
  it('Beginn und Ende in UTC, keine DURATION, stabile UID und SEQUENCE', () => {
    const ics = buildEventIcs(event, 'O du fröhliche… 🎶\n\nmax 15€', 'https://rsvp.example.test')!
    const unfolded = ics.replace(/\r?\n[ \t]/g, '')
    expect(unfolded).toContain('DTSTART:20261223T170000Z')
    expect(unfolded).toContain('DTEND:20261223T220000Z')
    expect(unfolded).not.toContain('DURATION')
    expect(unfolded).toContain('UID:event-cmevent0000000001@rsvp.example.test')
    expect(unfolded).toContain('SEQUENCE:2')
    expect(unfolded).toContain('LOCATION:Koblenzer Str 64\\, 56073 Koblenz')
    expect(unfolded).toContain('DESCRIPTION:O du fröhliche… 🎶\\n\\nmax 15€')
  })

  it('Ende über Mitternacht', () => {
    const ics = buildEventIcs({ ...event, date: new Date('2026-12-31T22:00:00Z'), duration: 4 }, '', 'https://rsvp.example.test')!
    expect(ics.replace(/\r?\n[ \t]/g, '')).toContain('DTEND:20270101T020000Z')
  })

  it('UID ohne gültige Adresse', () => {
    expect(icsUid('x', '')).toBe('event-x@rsvp-app.local')
  })
})

describe('foldIcs', () => {
  it('höchstens 75 Bytes je Zeile, keine zerschnittenen Zeichen, Inhalt unverändert', () => {
    const description = 'O du fröhliche… 🎶 gewichtelt❤️ '.repeat(12) + 'äöü'.repeat(40)
    const ics = buildEventIcs(event, description, 'https://rsvp.example.test')!
    const lines = ics.split('\r\n')
    expect(Math.max(...lines.map(l => Buffer.byteLength(l)))).toBeLessThanOrEqual(75)
    expect(lines.slice(1).filter(Boolean).every(l => /^[A-Z ]/.test(l))).toBe(true)
    expect(ics).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(ics.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${description.replace(/,/g, '\\,')}`)
  })

  it('kurze Zeilen bleiben, wie sie sind', () => {
    expect(foldIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR')
  })
})
