import { describe, expect, it } from 'vitest'
import { ARCHIVE_AFTER_MS, isArchived, splitArchived } from '../../app/lib/event-date'

const now = new Date('2026-10-04T12:00:00Z')
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs)
const HOUR = 60 * 60 * 1000

describe('isArchived', () => {
  it('archiviert erst 48 Stunden nach Beginn', () => {
    expect(isArchived({ date: at(HOUR) }, now)).toBe(false)
    expect(isArchived({ date: at(-47 * HOUR) }, now)).toBe(false)
    expect(isArchived({ date: at(-ARCHIVE_AFTER_MS + 1) }, now)).toBe(false)
    expect(isArchived({ date: at(-ARCHIVE_AFTER_MS) }, now)).toBe(true)
    expect(isArchived({ date: at(-30 * 24 * HOUR).toISOString() }, now)).toBe(true)
  })

  it('ein noch offenes Datum (datePending) ist nie archiviert', () => {
    expect(isArchived({ date: at(-365 * 24 * HOUR), datePending: true }, now)).toBe(false)
  })
})

describe('splitArchived', () => {
  it('trennt aufsteigend sortierte Termine, Archiv neueste zuerst', () => {
    const events = [-100, -60, -10, 5, 50].map(h => ({ id: h, date: at(h * HOUR) }))
    const { current, archived } = splitArchived(events, now)
    expect(current.map(e => e.id)).toEqual([-10, 5, 50])
    expect(archived.map(e => e.id)).toEqual([-60, -100])
  })
})
