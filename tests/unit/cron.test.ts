import { afterEach, describe, expect, it, vi } from 'vitest'

// Die Endpunkte dürfen bei fehlender Berechtigung die Datenbank gar nicht erst anfassen - jeder
// Zugriff auf einen PrismaClient wirft hier.
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return new Proxy({}, { get: () => { throw new Error('Datenbankzugriff ohne Berechtigung') } })
    }
  }
}))

const cleanup = await import('../../app/api/cron/cleanup/route')
const reminders = await import('../../app/api/cron/reminders/route')

afterEach(() => vi.unstubAllEnvs())

describe.each([
  ['cleanup', cleanup.GET],
  ['reminders', reminders.GET]
])('GET /api/cron/%s', (name, GET) => {
  const url = (query = '') => new Request(`http://x/api/cron/${name}${query}`)

  it('lehnt ab, wenn CRON_SECRET leer ist - auch mit leerem secret-Parameter', async () => {
    vi.stubEnv('CRON_SECRET', '')
    for (const query of ['', '?secret=', '?secret=egal']) {
      expect((await GET(url(query))).status).toBe(401)
    }
  })

  it('lehnt ab, wenn CRON_SECRET gar nicht gesetzt ist', async () => {
    vi.stubEnv('CRON_SECRET', undefined as unknown as string)
    expect((await GET(url('?secret=undefined'))).status).toBe(401)
  })

  it('lehnt ein falsches, abgeschnittenes oder fehlendes Secret ab', async () => {
    vi.stubEnv('CRON_SECRET', 'richtig')
    for (const query of ['', '?secret=falsch', '?secret=richti', '?secret=richtig2', '?secret=RICHTIG']) {
      expect((await GET(url(query))).status, query).toBe(401)
    }
  })

  it('Positivkontrolle: mit richtigem Secret geht es bis zur Datenbank', async () => {
    vi.stubEnv('CRON_SECRET', 'richtig')
    await expect(GET(url('?secret=richtig'))).rejects.toThrow('Datenbankzugriff ohne Berechtigung')
  })
})
