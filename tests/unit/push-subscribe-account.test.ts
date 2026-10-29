import { beforeEach, describe, expect, it, vi } from 'vitest'

// „Push für alle Termine“ (app/mein-konto/actions.ts): nur Endpoints der Push-Dienste (SSRF), nur mit Gast-Sitzung,
// nur für das eigene Konto.
const upsert = vi.fn()
const deleteMany = vi.fn()
const getCurrentGuestUser = vi.fn()
vi.mock('../../app/lib/prisma', () => ({ prisma: { guestUserPushSubscription: { upsert, deleteMany } } }))
vi.mock('../../app/lib/guest-auth', () => ({ getCurrentGuestUser, requireGuestUser: vi.fn(), createGuestSession: vi.fn(), destroyGuestSession: vi.fn(), GUEST_SESSION_COOKIE: 'x' }))

const { subscribeGuestUserToPush, unsubscribeGuestUserFromPush } = await import('../../app/mein-konto/actions')

const keys = { p256dh: 'B' + 'a'.repeat(86), auth: 'c'.repeat(22) }
const endpoint = 'https://fcm.googleapis.com/fcm/send/x'

beforeEach(() => {
  upsert.mockReset()
  deleteMany.mockReset()
  getCurrentGuestUser.mockReset().mockResolvedValue({ id: 'konto-1' })
})

describe('subscribeGuestUserToPush', () => {
  it('lehnt Endpoints außerhalb der Push-Dienste ab, ohne die Sitzung oder die Datenbank zu fragen', async () => {
    for (const bad of ['http://192.168.178.126:8123/api/services', 'https://localhost/x', 'https://evil.example/fcm.googleapis.com']) {
      await subscribeGuestUserToPush({ endpoint: bad, keys })
    }
    await subscribeGuestUserToPush({ endpoint, keys: { p256dh: '<script>', auth: keys.auth } })
    expect(getCurrentGuestUser).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('ohne Gast-Sitzung passiert nichts', async () => {
    getCurrentGuestUser.mockResolvedValue(null)
    await subscribeGuestUserToPush({ endpoint, keys })
    await unsubscribeGuestUserFromPush(endpoint)
    expect(upsert).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('Positivkontrolle: echtes Abo wird für das eigene Konto gespeichert und nur dort wieder entfernt', async () => {
    await subscribeGuestUserToPush({ endpoint, keys })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { guestUserId_endpoint: { guestUserId: 'konto-1', endpoint } },
      create: { endpoint, ...keys, guestUserId: 'konto-1' }
    }))
    await unsubscribeGuestUserFromPush(endpoint)
    expect(deleteMany).toHaveBeenCalledWith({ where: { endpoint, guestUserId: 'konto-1' } })
  })
})
