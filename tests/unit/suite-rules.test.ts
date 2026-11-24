import { afterEach, it, vi } from 'vitest'
import { suiteRules } from 'suite-kit/rules'

// Gemeinsame Regeln der Suite (suite-kit/rules, docs/KONVENTIONEN.md dort): Prüfungen aus den Audits aller Tools,
// die hier gegen die EIGENEN Funktionen laufen. Kommt mit einer neuen suite-kit-Version eine Regel dazu, wird sie
// hier von selbst rot, wenn rsvp-app sie nicht erfüllt (scripts/update-apps.mjs in suite-kit lässt diese Datei laufen).
//
// Ohne normalizeEmail: rsvp-app hat keine eigene Kopie, alle Formulare prüfen mit isSingleEmail aus suite-kit/web.

let forwardedFor: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor })
}))
vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const { clientIp } = await import('../../app/lib/throttle')

afterEach(() => {
  vi.unstubAllEnvs()
  forwardedFor = null
})

const viaHeader = (header: string) => {
  vi.stubEnv('TRUST_PROXY_HOPS', '1')
  forwardedFor = header
  return clientIp()
}

for (const rule of suiteRules({ clientIp: viaHeader })) it(rule.name, rule.run)
