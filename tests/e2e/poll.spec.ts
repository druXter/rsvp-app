import { createHmac } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  BASE_URL, TEST_POLL_SECRET, cookieHeader, createAccount, createEvent, createGuestUser, createRsvp, createSeries,
  createTermin, decodeCouplingToken, plantGuestSession, prisma, signCouplingToken, unlockPin
} from './helpers'

// Kopplung mit dem Abstimmungstool (app/lib/poll-verification.ts). Beide Richtungen tragen
// `base64url(JSON).base64url(HMAC-SHA256)` mit dem gemeinsamen POLL_VERIFICATION_SECRET:
// eingehend die Ergebnis-Meldung (POST /api/poll-result-webhook), ausgehend der Klick-Token, den
// /api/poll-link/[eventId] an die Abstimmungs-URL hängt.

const nowSeconds = () => Math.floor(Date.now() / 1000)

function resultPayload(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    pollId: 'poll-e2e',
    pollTitle: 'Wohin gehen wir?',
    winners: [{ label: 'Kino', votes: 3 }],
    closedAt: new Date().toISOString(),
    exp: nowSeconds() + 600,
    ...overrides
  }
}

async function deliver(request: APIRequestContext, body: string) {
  return request.post('/api/poll-result-webhook', { data: body, headers: { 'content-type': 'text/plain' } })
}

test('Ergebnis-Meldung: manipulierte, abgelaufene oder fremd signierte Meldungen werden abgelehnt', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const other = await createEvent(owner)
  const valid = signCouplingToken(resultPayload(event.id))
  const [validPayload, validSignature] = valid.split('.')
  const flipped = validSignature.slice(0, -1) + (validSignature.endsWith('A') ? 'B' : 'A')

  const attacks: Record<string, string> = {
    'Signatur verändert': `${validPayload}.${flipped}`,
    'Inhalt verändert, alte Signatur': `${signCouplingToken(resultPayload(other.id)).split('.')[0]}.${validSignature}`,
    'abgelaufen': signCouplingToken(resultPayload(event.id, { exp: nowSeconds() - 5 })),
    'ohne Ablaufzeit': signCouplingToken(resultPayload(event.id, { exp: undefined })),
    'falsches Geheimnis': signCouplingToken(resultPayload(event.id), 'ein-anderes-geheimnis'),
    'ohne Signatur': validPayload,
    'leere Signatur': `${validPayload}.`,
    'drei Teile': `${valid}.extra`,
    'leer': '',
    'kein Token': 'hallo welt',
    // Die eigenen ausgehenden Tokens (Klick-Token, Zu-/Absage-Meldung) sind mit demselben
    // Geheimnis signiert, dürfen aber nie als Ergebnis-Meldung zurückgespielt werden können.
    'Klick-Token': signCouplingToken({ email: 'a@example.test', pollId: 'poll-e2e', attending: true, exp: nowSeconds() + 600 }),
    'Zu-/Absage-Meldung': signCouplingToken({ email: 'a@example.test', pollId: 'poll-e2e', eventId: event.id, attending: true, exp: nowSeconds() + 600 }),
    'Gewinner kein Array': signCouplingToken(resultPayload(event.id, { winners: 'Kino' }))
  }
  for (const [name, body] of Object.entries(attacks)) {
    const response = await deliver(request, body)
    expect(response.status(), name).toBe(401)
  }
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).pollResult).toBeNull()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: other.id } })).pollResult).toBeNull()

  // Positivkontrolle
  const accepted = await deliver(request, valid)
  expect(accepted.status()).toBe(200)
  expect(JSON.parse((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).pollResult!)).toMatchObject({
    pollTitle: 'Wohin gehen wir?',
    winners: [{ label: 'Kino', votes: 3 }]
  })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: other.id } })).pollResult).toBeNull()

  // Gültig signiert, aber unbekanntes Event: kein Fehler, nichts gespeichert.
  const unknown = await deliver(request, signCouplingToken(resultPayload('gibt-es-nicht')))
  expect(unknown.status()).toBe(200)
})

test('Abstimmungs-Link eines PIN-Events: ohne Freischaltung keine Abstimmungs-URL', async ({ page, context }) => {
  const owner = await createAccount('CREATOR')
  const locked = await createEvent(owner, { eventPin: '2468', pollUrl: 'https://abstimmung.example/p/geheim' })
  const noPoll = await createEvent(owner)
  const target = async (id: string) => {
    const response = await page.request.get(`/api/poll-link/${id}`, { headers: await cookieHeader(context), maxRedirects: 0 })
    expect(response.status()).toBe(307)
    return response.headers()['location']
  }

  expect(await target(locked.id)).toBe(`${BASE_URL}/`)
  expect(await target(noPoll.id)).toBe(`${BASE_URL}/`)
  expect(await target('gibt-es-nicht')).toBe(`${BASE_URL}/`)

  // Positivkontrolle
  await unlockPin(context, `event_pin_${locked.id}`, '2468')
  expect(await target(locked.id)).toBe('https://abstimmung.example/p/geheim')
})

test('Klick-Token nur für bestätigte Nutzer-Konten, an Abstimmung gebunden, 10 Minuten gültig', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series, { pollUrl: 'https://abstimmung.example/p/poll42?lang=de' })
  const attending = await createGuestUser()
  const declined = await createGuestUser()
  const unverified = await createGuestUser({ verified: false })
  await createRsvp(termin, { guestUserId: attending.id, isAttending: true })
  await createRsvp(termin, { guestUserId: declined.id, isAttending: false })

  async function follow(guest: typeof attending | null): Promise<URL> {
    const page = await browser.newPage()
    if (guest) await plantGuestSession(page.context(), guest)
    const response = await page.request.get(`/api/poll-link/${termin.id}`, { headers: await cookieHeader(page.context()), maxRedirects: 0 })
    expect(response.status()).toBe(307)
    await page.close()
    return new URL(response.headers()['location'])
  }

  // Ohne Sitzung oder mit unbestätigtem Konto: bloße Abstimmungs-URL, kein Token.
  for (const guest of [null, unverified]) {
    const url = await follow(guest)
    expect(url.origin + url.pathname).toBe('https://abstimmung.example/p/poll42')
    expect(url.searchParams.has('verify')).toBe(false)
  }

  // Positivkontrolle: bestätigtes Konto mit Zusage.
  const url = await follow(attending)
  expect(url.searchParams.get('lang')).toBe('de')
  const token = url.searchParams.get('verify')!
  const [payloadPart, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_POLL_SECRET).update(payloadPart).digest('base64url'))
  expect(signature).not.toBe(createHmac('sha256', 'ein-anderes-geheimnis').update(payloadPart).digest('base64url'))
  const payload = decodeCouplingToken(token)
  expect(payload).toMatchObject({ email: attending.email, pollId: 'poll42', attending: true })
  expect(payload.exp).toBeGreaterThan(nowSeconds() + 590)
  expect(payload.exp).toBeLessThanOrEqual(nowSeconds() + 600)

  // Eine Absage wird mitgeteilt, statt die Person als zugesagt auszugeben.
  expect(decodeCouplingToken((await follow(declined)).searchParams.get('verify')!)).toMatchObject({ email: declined.email, attending: false })
})
