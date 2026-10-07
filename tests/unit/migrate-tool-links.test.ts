import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

// Die Migrationen sind CommonJS-Skripte für den Containerstart - hier mit einer Schein-Datenbank
// statt SQLite.
const requireScript = createRequire(import.meta.url)
const toolLinks = requireScript('../../migrate-tool-links.js')
const dropColumns = requireScript('../../migrate-drop-seating-columns.js')

function fakeDb(version: number, columns: string[] = ['id', 'title', 'ownerId']) {
  const db = {
    version,
    columns: [...columns],
    statements: [] as string[],
    $queryRawUnsafe: vi.fn(async (sql: string) =>
      sql.startsWith('PRAGMA table_info') ? db.columns.map(name => ({ name })) : [{ user_version: BigInt(db.version) }]),
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      db.statements.push(sql)
      const version = sql.match(/user_version = (\d+)/)
      if (version) db.version = Number(version[1])
      const dropped = sql.match(/DROP COLUMN "(\w+)"/)
      if (dropped) db.columns = db.columns.filter(c => c !== dropped[1])
      return 0
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db))
  }
  return db
}

const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {})

describe('migrate-tool-links.js', () => {
  it('setzt nach der Token-Migration nur noch die Version 2, einmal', async () => {
    const log = quiet()
    const db = fakeDb(1)
    await toolLinks.main(db)
    expect(db.version).toBe(2)
    await toolLinks.main(db)
    expect(db.statements).toHaveLength(1)
    log.mockRestore()
  })

  it('bricht ohne Token-Migration ab (user_version 0)', async () => {
    const db = fakeDb(0)
    await expect(toolLinks.main(db)).rejects.toThrow('migrate-token-hashes.js')
    expect(db.version).toBe(0)
  })
})

describe('migrate-drop-seating-columns.js', () => {
  const legacy = ['id', 'title', 'seatingUrl', 'seatingPlacementsAt', 'ownerId']

  it('entfernt beide alten Spalten, wenn die Links übernommen sind (user_version 2)', async () => {
    const log = quiet()
    const db = fakeDb(2, legacy)
    await dropColumns.main(db)
    expect(db.columns).toEqual(['id', 'title', 'ownerId'])
    expect(db.statements).toEqual([
      'ALTER TABLE "Event" DROP COLUMN "seatingUrl"',
      'ALTER TABLE "Event" DROP COLUMN "seatingPlacementsAt"'
    ])
    log.mockRestore()
  })

  it('tut nichts, wenn es die Spalten nicht (mehr) gibt - frische Datenbank oder zweiter Lauf', async () => {
    const log = quiet()
    for (const version of [0, 2]) {
      const db = fakeDb(version)
      await dropColumns.main(db)
      expect(db.statements).toEqual([])
    }
    log.mockRestore()
  })

  it('bricht ab statt Links zu verlieren, wenn sie noch nie übernommen wurden (user_version < 2)', async () => {
    for (const version of [0, 1]) {
      const db = fakeDb(version, legacy)
      await expect(dropColumns.main(db)).rejects.toThrow('noch nicht nach EventToolLink')
      expect(db.columns).toEqual(legacy)
      expect(db.statements).toEqual([])
    }
  })
})
