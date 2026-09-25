import { expect, test, type APIRequestContext } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel
// gewinnt): /admin und /mein-konto passen auch auf die Event-Regel "/:slug" und müssen trotzdem
// ihr "nicht einbetten" behalten, /api/suite/* überschreibt die allgemeine Referrer-Policy.

// Erste Pfadebene = Event-Slugs, bewusst einbettbar (CMS-iFrame). Dazu gehören zwangsläufig auch
// alle anderen Pfade auf erster Ebene, u. a. der Service Worker.
const EMBEDDABLE = ['/irgendein-event', '/impressum', '/datenschutz', '/sw.js', '/manifest.webmanifest']
const LOCKED = [
  '/admin', '/admin/login', '/admin/account', '/admin/users', '/admin/forgot-password',
  '/admin/reset-password?token=abc', '/admin/checkin/unbekannt',
  '/mein-konto', '/mein-konto/login', '/mein-konto/account', '/mein-konto/reset-password?token=abc'
]
const SUITE = ['/api/suite/authorize', '/api/suite/login', '/api/suite/callback']
const OTHER = ['/', '/reihe/gibt-es-nicht', '/reihe/gibt-es-nicht/termin', '/api/cron/cleanup', '/api/v1/me']

async function headersOf(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Pfadgruppe', async ({ request }) => {
  for (const path of [...EMBEDDABLE, ...LOCKED, ...SUITE, ...OTHER]) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()')
  }
})

test('Referrer-Policy: allgemein strict-origin-when-cross-origin, Föderations-Pfade no-referrer', async ({ request }) => {
  for (const path of [...EMBEDDABLE, ...LOCKED, ...OTHER]) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
  }
  for (const path of SUITE) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('no-referrer')
  }
})

test('Event-Slugs und andere Pfade erster Ebene (inkl. /sw.js) sind einbettbar', async ({ request }) => {
  for (const path of EMBEDDABLE) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe('frame-ancestors *;')
    expect(h['x-frame-options'], path).toBeUndefined()
  }
})

test('Admin- und Konto-Bereich: nie einbettbar - auch die Weiterleitung ohne Sitzung', async ({ request }) => {
  for (const path of LOCKED) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
  }
})

test('Föderations-Endpunkte /api/suite/*: nie einbettbar', async ({ request }) => {
  for (const path of SUITE) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
  }
})

test('tiefere Gast- und API-Pfade tragen nur die allgemeinen Header', async ({ request }) => {
  for (const path of OTHER) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBeUndefined()
    expect(h['x-frame-options'], path).toBeUndefined()
  }
})
