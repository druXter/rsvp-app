import { expect, test, type APIRequestContext } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel gewinnt) und das
// Muster der Suite: Einbetten grundsätzlich verboten, erlaubt nur für die Gästeseiten.

// Gästeseiten, bewusst einbettbar (CMS-iFrame), samt der Registrierung, auf die sie im selben Frame verlinken.
const EMBEDDABLE = [
  '/irgendein-event', '/irgendein-event/registrieren',
  '/reihe/gibt-es-nicht', '/reihe/gibt-es-nicht/termin', '/reihe/gibt-es-nicht/registrieren'
]
const PRIVATE = [
  '/admin', '/admin/login', '/admin/account', '/admin/users', '/admin/forgot-password',
  '/admin/reset-password?token=abc', '/admin/checkin/unbekannt',
  '/mein-konto', '/mein-konto/login', '/mein-konto/account', '/mein-konto/reset-password?token=abc'
]
// Einteilige Seiten des Tools und alles Mehrteilige außer den Gästeseiten: nicht einbettbar.
const NOT_EMBEDDABLE = ['/', '/verify?token=abc', '/impressum', '/datenschutz', '/manifest.webmanifest', '/api/cron/cleanup', '/api/v1/me', '/irgendein-event/sonstwas']
const TOKEN_PAGES = ['/verify?token=abc', '/admin/reset-password?token=abc', '/mein-konto/reset-password?token=abc', '/mein-konto/verify?token=abc', '/admin/confirm-email?token=abc', '/mein-konto/confirm-email?token=abc']
const SUITE = ['/api/suite/authorize', '/api/suite/login', '/api/suite/callback']

async function headersOf(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Pfadgruppe', async ({ request }) => {
  for (const path of [...EMBEDDABLE, ...PRIVATE, ...NOT_EMBEDDABLE, ...SUITE, '/sw.js']) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()')
  }
})

test('Referrer-Policy: allgemein strict-origin-when-cross-origin, Token- und Föderations-Pfade no-referrer', async ({ request }) => {
  for (const path of [...EMBEDDABLE, '/admin', '/mein-konto/login', '/']) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
  }
  for (const path of [...TOKEN_PAGES, ...SUITE]) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('no-referrer')
  }
})

test('Gästeseiten sind einbettbar', async ({ request }) => {
  for (const path of EMBEDDABLE) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe('frame-ancestors *')
    expect(h['x-frame-options'], path).toBeUndefined()
  }
})

test('alles andere ist nicht einbettbar - auch /verify mit dem Bestätigungsknopf und /reihe ohne Reihe', async ({ request }) => {
  for (const path of [...PRIVATE, ...NOT_EMBEDDABLE, ...SUITE, '/reihe']) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
  }
})

test('Verwaltung, Konto und Token-Seiten: nicht indexieren, nicht cachen', async ({ request }) => {
  for (const path of [...PRIVATE, ...TOKEN_PAGES]) {
    const h = await headersOf(request, path)
    expect(h['x-robots-tag'], path).toBe('noindex, nofollow')
    expect(h['cache-control'], path).toContain('no-store')
  }
  // Positivkontrolle: Gästeseiten bleiben auffindbar.
  expect((await headersOf(request, '/irgendein-event'))['x-robots-tag']).toBeUndefined()
})

test('Service Worker: nie aus dem Cache, eigene CSP', async ({ request }) => {
  const h = await headersOf(request, '/sw.js')
  expect(h['cache-control']).toBe('no-cache, no-store, must-revalidate')
  expect(h['content-security-policy']).toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'")
  expect(h['content-type']).toContain('application/javascript')
})
