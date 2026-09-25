import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, safeEqual } from '../../app/lib/tokens'
import { generateApiToken, hashApiToken } from '../../app/lib/api-auth'

describe('Sitzungs- und Link-Tokens', () => {
  it('sind 32 zufällige Bytes (base64url) und werden als SHA-256 gespeichert', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateToken()).not.toBe(token)
    expect(hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hashToken(token)).not.toContain(token)
  })

  it('API-Tokens tragen das Präfix rsvp_ und werden ebenfalls nur gehasht gespeichert', () => {
    const token = generateApiToken()
    expect(token).toMatch(/^rsvp_[0-9a-f]{64}$/)
    expect(hashApiToken(token)).toBe(createHash('sha256').update(token).digest('hex'))
  })
})

describe('safeEqual', () => {
  it('vergleicht korrekt, auch bei unterschiedlicher Länge', () => {
    expect(safeEqual('geheim', 'geheim')).toBe(true)
    expect(safeEqual('geheim', 'geheiM')).toBe(false)
    expect(safeEqual('geheim', 'geheim2')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
