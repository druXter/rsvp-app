import { afterEach, describe, expect, it, vi } from 'vitest'

// clientIp liest den Header über next/headers - hier durch einen festen Wert ersetzt.
let forwardedFor: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor })
}))
// Die Datenbank wird für clientIp und die Regeln nicht gebraucht.
vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const { clientIp, loginRules, passwordChangeRule, pinRules, registerRules, resetRules } = await import('../../app/lib/throttle')

afterEach(() => {
  vi.unstubAllEnvs()
  forwardedFor = null
})

describe('clientIp', () => {
  it('nimmt bei einem Proxy den letzten Eintrag - links Erfundenes zählt nicht', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    forwardedFor = '6.6.6.6, 203.0.113.7'
    expect(await clientIp()).toBe('203.0.113.7')
  })

  it('zählt bei zwei Proxys den vorletzten Eintrag', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2')
    forwardedFor = '6.6.6.6, 203.0.113.7, 10.0.0.2'
    expect(await clientIp()).toBe('203.0.113.7')
  })

  it('ignoriert den Header bei 0 oder ungültigem Wert komplett', async () => {
    forwardedFor = '203.0.113.7'
    vi.stubEnv('TRUST_PROXY_HOPS', '0')
    expect(await clientIp()).toBe('unknown')
    vi.stubEnv('TRUST_PROXY_HOPS', 'abc')
    expect(await clientIp()).toBe('unknown')
  })

  it('liefert "unknown" ohne Header oder bei zu wenigen Einträgen', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2')
    expect(await clientIp()).toBe('unknown')
    forwardedFor = '203.0.113.7'
    expect(await clientIp()).toBe('unknown')
  })
})

describe('Regeln', () => {
  it('Login: pro E-Mail strenger als pro IP, Admin- und Gast-Login getrennt', () => {
    const rules = loginRules('203.0.113.7', 'a@b.de')
    expect(rules.email.limit).toBe(10)
    expect(rules.ip.limit).toBe(20)
    expect(rules.ip.scope).not.toBe(rules.email.scope)
    expect(loginRules('203.0.113.7', 'a@b.de', 'guest-login').email.scope).not.toBe(rules.email.scope)
  })

  it('Passwort-Reset und Registrierung: höchstens 3 Mails pro Adresse und Stunde', () => {
    const [ip, email] = resetRules('203.0.113.7', 'a@b.de')
    expect(email.limit).toBe(3)
    expect(ip.limit).toBe(10)
    expect(registerRules('203.0.113.7', 'a@b.de').map(r => r.limit)).toEqual([10, 3])
  })

  it('PIN: pro IP und Ziel 10 Versuche, pro Ziel insgesamt 100', () => {
    const [perIp, perTarget] = pinRules('203.0.113.7', 'event-1')
    expect(perIp).toMatchObject({ identifier: '203.0.113.7:event-1', limit: 10 })
    expect(perTarget).toMatchObject({ identifier: 'event-1', limit: 100 })
  })

  it('aktuelles Passwort bei Konto-Änderungen: 10 Versuche pro Konto', () => {
    expect(passwordChangeRule('user-1')).toMatchObject({ identifier: 'user-1', limit: 10 })
  })
})
