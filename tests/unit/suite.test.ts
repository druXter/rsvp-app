import { afterEach, describe, expect, it, vi } from 'vitest'
import { loginRedirectIdp, shouldAutoRedirect } from '../../app/lib/suite'

describe('shouldAutoRedirect (Login-Seite direkt zum bevorzugten Anbieter)', () => {
  it('leitet beim schlichten Aufruf weiter, auch mit next', () => {
    expect(shouldAutoRedirect({}, '/admin')).toBe(true)
    expect(shouldAutoRedirect({ next: '/admin/events' }, '/admin/events')).toBe(true)
  })

  it('zeigt das Formular bei Fehler, Reset, local und unbekannten Parametern (keine Schleife nach Fehlschlag)', () => {
    for (const params of [{ error: 'sso' }, { error: 'not-linked' }, { reset: '1' }, { local: '1' }, { local: '' }, { foo: 'x' }]) {
      expect(shouldAutoRedirect(params, '/admin'), JSON.stringify(params)).toBe(false)
    }
  })

  it('nie, wenn dieses Tool selbst als Anbieter gefragt ist (keine Ketten)', () => {
    const next = '/api/suite/authorize?app=https%3A%2F%2Fa.example&state=x'
    expect(shouldAutoRedirect({ next }, next)).toBe(false)
  })
})

describe('loginRedirectIdp (SUITE_LOGIN_REDIRECT)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('ohne Variable: kein bevorzugter Anbieter', () => {
    vi.stubEnv('SUITE_LOGIN_REDIRECT', '')
    expect(loginRedirectIdp()).toBeNull()
  })

  it('nur ein Origin aus SUITE_IDPS gilt, sonst Warnung und nichts', async () => {
    vi.resetModules()
    vi.stubEnv('BASE_URL', 'https://rsvp.example.de')
    vi.stubEnv('SUITE_IDPS', 'https://seating.example.de,https://vote.example.de')
    const { loginRedirectIdp: fresh } = await import('../../app/lib/suite')
    vi.stubEnv('SUITE_LOGIN_REDIRECT', 'https://vote.example.de/')
    expect(fresh()?.issuer).toBe('https://vote.example.de')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('SUITE_LOGIN_REDIRECT', 'https://evil.example.de')
    expect(fresh()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
