import { beforeEach, describe, expect, it, vi } from 'vitest'

// Push-Abos von Gästen (persönlicher Link): gespeichert werden nur Endpoints der Push-Dienste der Browser-Hersteller -
// sonst schickte der Server später Anfragen an beliebige Adressen, auch im internen Netz (SSRF).
const upsert = vi.fn()
const findUnique = vi.fn()
vi.mock('../../app/lib/prisma', () => ({ prisma: { participant: { findUnique }, participantPushSubscription: { upsert } } }))

const { subscribeParticipantToPush } = await import('../../app/actions')

const keys = { p256dh: 'B' + 'a'.repeat(86), auth: 'c'.repeat(22) }

beforeEach(() => {
  upsert.mockReset()
  findUnique.mockReset().mockResolvedValue({ id: 'participant-1' })
})

describe('subscribeParticipantToPush', () => {
  it('lehnt Endpoints außerhalb der Push-Dienste ab, ohne die Datenbank zu fragen', async () => {
    for (const endpoint of ['http://192.168.178.126:8123/api/services', 'https://localhost/x', 'https://evil.example/fcm.googleapis.com']) {
      await subscribeParticipantToPush('token', { endpoint, keys })
    }
    await subscribeParticipantToPush('token', { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: '<script>', auth: keys.auth } })
    await subscribeParticipantToPush(42, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })
    expect(findUnique).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('Positivkontrolle: echtes Abo mit gültigem Link wird gespeichert', async () => {
    await subscribeParticipantToPush('token', { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })
    expect(findUnique).toHaveBeenCalledWith({ where: { editToken: 'token' } })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', ...keys, participantId: 'participant-1' }
    }))
  })
})
