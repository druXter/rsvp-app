import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

// Die Migration ist ein CommonJS-Skript für den Containerstart (migrate-tool-links.js) - hier mit
// einer Schein-Datenbank statt SQLite.
const requireScript = createRequire(import.meta.url)
const { copyLegacySeatingLinks, main } = requireScript('../../migrate-tool-links.js')

type Row = { eventId: string; type: string; url: string; remoteEventId: string; syncedAt: Date | null }

function fakeDb(events: { id: string; seatingUrl: string | null; seatingPlacementsAt: Date | null }[], links: Row[] = [], version = 1) {
  const db = {
    links,
    version,
    event: { findMany: vi.fn(async () => events.filter(e => e.seatingUrl !== null)) },
    eventToolLink: {
      findUnique: vi.fn(async ({ where }: { where: { eventId_type: { eventId: string; type: string } } }) =>
        db.links.find(l => l.eventId === where.eventId_type.eventId && l.type === where.eventId_type.type) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { db.links.push(data); return data })
    },
    $queryRawUnsafe: vi.fn(async () => [{ user_version: BigInt(db.version) }]),
    $executeRawUnsafe: vi.fn(async (sql: string) => { db.version = Number(sql.match(/= (\d+)/)![1]); return 0 }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db))
  }
  return db
}

const placedAt = new Date('2026-09-01T10:00:00Z')

describe('migrate-tool-links.js', () => {
  it('übernimmt jede alte seatingUrl unverändert als EventToolLink "seating", seatingPlacementsAt als syncedAt', async () => {
    const db = fakeDb([
      { id: 'cmevent000000000001', seatingUrl: 'https://plaetze.example.de/rsvp/cmseatingevent00001', seatingPlacementsAt: placedAt },
      // Link, den die aktuelle Konfiguration vielleicht nicht (mehr) annimmt - geht trotzdem nicht verloren
      { id: 'cmevent000000000002', seatingUrl: 'https://alt.example.de/rsvp/cmseatingevent00002', seatingPlacementsAt: null },
      { id: 'cmevent000000000003', seatingUrl: null, seatingPlacementsAt: null },
      { id: 'cmevent000000000004', seatingUrl: '   ', seatingPlacementsAt: null }
    ])
    expect(await copyLegacySeatingLinks(db)).toBe(2)
    expect(db.links).toEqual([
      { eventId: 'cmevent000000000001', type: 'seating', url: 'https://plaetze.example.de/rsvp/cmseatingevent00001', remoteEventId: 'cmseatingevent00001', syncedAt: placedAt },
      { eventId: 'cmevent000000000002', type: 'seating', url: 'https://alt.example.de/rsvp/cmseatingevent00002', remoteEventId: 'cmseatingevent00002', syncedAt: null }
    ])
  })

  it('überschreibt keine vorhandene Verknüpfung', async () => {
    const existing = { eventId: 'cmevent000000000001', type: 'seating', url: 'https://plaetze.example.de/rsvp/cmneueseatingid0001', remoteEventId: 'cmneueseatingid0001', syncedAt: null }
    const db = fakeDb([{ id: 'cmevent000000000001', seatingUrl: 'https://plaetze.example.de/rsvp/cmseatingevent00001', seatingPlacementsAt: null }], [existing])
    expect(await copyLegacySeatingLinks(db)).toBe(0)
    expect(db.links).toEqual([existing])
  })

  it('läuft genau einmal (user_version 2) und nur nach der Token-Migration (user_version 1)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const events = [{ id: 'cmevent000000000001', seatingUrl: 'https://plaetze.example.de/rsvp/cmseatingevent00001', seatingPlacementsAt: null }]

    const fresh = fakeDb(events, [], 0)
    await expect(main(fresh)).rejects.toThrow('migrate-token-hashes.js')
    expect(fresh.links).toEqual([])
    expect(fresh.version).toBe(0)

    const db = fakeDb(events)
    await main(db)
    expect(db.links).toHaveLength(1)
    expect(db.version).toBe(2)

    // Zweiter Lauf, nachdem die Verknüpfung in der Oberfläche entfernt wurde: bleibt entfernt
    db.links = []
    await main(db)
    expect(db.links).toEqual([])
    log.mockRestore()
  })
})
