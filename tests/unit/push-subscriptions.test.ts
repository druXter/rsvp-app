import { describe, expect, it, vi } from 'vitest'

vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const { describePushError, isExpiredPushError } = await import('../../app/lib/push-subscriptions')

describe('Push-Versandfehler (app/lib/push-subscriptions.ts)', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/geheime-kennung'

  it('404 und 410 heißen „abgelaufen“, alles andere nicht', () => {
    expect(isExpiredPushError({ statusCode: 410 })).toBe(true)
    expect(isExpiredPushError({ statusCode: 404 })).toBe(true)
    expect(isExpiredPushError({ statusCode: 429 })).toBe(false)
    expect(isExpiredPushError(new Error('ECONNRESET'))).toBe(false)
    expect(isExpiredPushError(null)).toBe(false)
  })

  it('Log nennt Push-Dienst und Status, nie den Endpoint', () => {
    const expired = describePushError(endpoint, Object.assign(new Error('Received unexpected response code'), { statusCode: 410 }))
    expect(expired).toBe('fcm.googleapis.com 410 (Abo abgelaufen, als abgelaufen markiert)')
    const other = describePushError(endpoint, Object.assign(new Error('Too many requests'), { statusCode: 429 }))
    expect(other).toBe('fcm.googleapis.com 429 (Too many requests)')
    expect(describePushError(endpoint, new Error('socket hang up'))).toBe('fcm.googleapis.com ohne Status (socket hang up)')
    for (const line of [expired, other]) expect(line).not.toContain('geheime-kennung')
  })
})
