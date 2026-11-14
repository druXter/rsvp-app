import { afterEach, describe, expect, it, vi } from 'vitest'

// Sicherheitsprüfung November 2026 (docs/AUDIT-2026-11.md): Funde in reiner Logik. Jeder Test beginnt mit einer
// Gegenprobe (der erlaubte Fall geht durch) und scheitert erst an der Zeile, die den Fund zeigt. Rechte, Sitzungen
// und Routen prüft tests/e2e/audit-2026-11.spec.ts.

let forwardedFor: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor })
}))
vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const { clientIp, pinRules } = await import('../../app/lib/throttle')

afterEach(() => {
  vi.unstubAllEnvs()
  forwardedFor = null
})

describe('R-08 Drosselung', () => {
  it('R-08a Drosselung: Adressen aus demselben IPv6-Netz (/64) zählen als ein Besucher', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    const ipOf = async (address: string) => {
      forwardedFor = address
      return clientIp()
    }
    // Gegenprobe: IPv4 bleibt, wie es ist, und zwei verschiedene Netze bleiben zwei Besucher.
    expect(await ipOf('203.0.113.7')).toBe('203.0.113.7')
    expect(await ipOf('2001:db8:1:2::1')).not.toBe(await ipOf('2001:db8:9:9::1'))

    // Fund: Ein Anschluss bekommt ein ganzes /64 (2^64 Adressen). Jede davon ist heute ein eigener Besucher mit
    // eigenem Zähler - die Regel "pro IP" bremst so jemanden gar nicht.
    expect(await ipOf('2001:db8:1:2:aaaa:bbbb:cccc:1')).toBe(await ipOf('2001:db8:1:2:1111:2222:3333:4444'))
  })

  it('R-08b Drosselung: eine vierstellige PIN hält dem Limit pro Ziel eine Woche stand', () => {
    const [perIp, perTarget] = pinRules('203.0.113.7', 'event-1')
    // Gegenprobe: Es gibt beide Regeln, die pro Besucher ist die strengere.
    expect(perIp.scope).toBe('pin:ip')
    expect(perTarget.scope).toBe('pin:target')
    expect(perIp.limit).toBeLessThan(perTarget.limit)

    // Fund: Mit wechselnden Adressen (R-08a) gilt nur das Limit pro Ziel - 100 Versuche je 15 Minuten sind 9600 am
    // Tag, alle 10 000 vierstelligen PINs also in gut einem Tag.
    const perWeek = perTarget.limit * ((7 * 24 * 60 * 60 * 1000) / perTarget.windowMs)
    expect(perWeek).toBeLessThan(10_000)
  })
})
