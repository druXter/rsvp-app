import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Event, User } from '@prisma/client'
import {
  BASE_URL, SEATING_PORT, TEST_SEATING_BASE_URL, TEST_SEATING_SECRET, cookieHeader, createAccount, createEvent,
  createGuestUser, createRsvp, createSeries, createTermin, decodeCouplingToken, locationOf, login, plantGuestSession,
  prisma, readForm, signCouplingToken, submitForm, unique, unlockPin
} from './helpers'

// Kopplung mit Seating (app/lib/seating.ts, Gegenstück dort app/lib/rsvp/token.ts). Alle Nachrichten
// tragen base64url(JSON).base64url(HMAC-SHA256) mit dem eigenen SEATING_SECRET. Geprüft wird:
// "Sitzplatz wählen" (/api/seating-link/[eventId]), die Gästeliste und die Platzierungen, die Seating
// abruft bzw. meldet (/api/seating/*), und der Webhook an Seating. Für den Webhook läuft hier ein
// Schein-Seating auf SEATING_BASE_URL, das jede Meldung mitschreibt.

const received: { path: string; body: string }[] = []
let seating: Server

test.beforeAll(async () => {
  seating = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      received.push({ path: req.url ?? '', body })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>(resolve => seating.listen(SEATING_PORT, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await new Promise(resolve => seating.close(resolve))
})

const nowSeconds = () => Math.floor(Date.now() / 1000)
/** Eine Seating-Event-id im Format beider Seiten (cuid-artig, [a-z0-9]{10,40}). */
const seatingId = () => 'cmseat' + randomBytes(10).toString('hex')
const seatingUrlFor = (id: string) => `${TEST_SEATING_BASE_URL}/rsvp/${id}`
const sign = (payload: object, secret = TEST_SEATING_SECRET) => signCouplingToken(payload, secret)

async function linkedEvent(owner: User, data: Partial<Event> = {}) {
  const id = seatingId()
  const event = await createEvent(owner, { seatingUrl: seatingUrlFor(id), ...data })
  return { event, seatingEventId: id }
}

function envelope(typ: string, event: Event, seatingEventId: string, overrides: Record<string, unknown> = {}) {
  return { typ, aud: BASE_URL, iat: nowSeconds(), exp: nowSeconds() + 600, seatingEventId, rsvpEventId: event.id, ...overrides }
}

const post = (request: APIRequestContext, path: string, body: string) =>
  request.post(path, { data: body, headers: { 'content-type': 'text/plain' } })

function verifySigned(token: string) {
  const [payload, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_SEATING_SECRET).update(payload).digest('base64url'))
  return decodeCouplingToken(token)
}

/** Meldungen an Schein-Seating zu einer Zusage (in Eingangsreihenfolge). */
const changesFor = (rsvpId: string) => received
  .filter(r => r.path === '/api/rsvp-webhook')
  .map(r => verifySigned(r.body))
  .filter(m => m.rsvpId === rsvpId)

test.describe('Sitzplatz wählen (/api/seating-link)', () => {
  const open = (request: APIRequestContext, eventId: string, token?: string, headers: Record<string, string> = {}) =>
    request.get(`/api/seating-link/${eventId}${token ? `?token=${encodeURIComponent(token)}` : ''}`, { maxRedirects: 0, headers })

  test('nur für eine Zusage, die zählt - ein fremder oder erfundener editToken wird abgelehnt', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner)
    const confirmed = await createRsvp(event, { name: 'Erika Muster' })
    await prisma.rsvp.update({ where: { id: confirmed.rsvp.id }, data: { plusOne: true, plusOneName: 'Max' } })
    const waitlisted = await createRsvp(event, { isOnWaitlist: true })
    const declined = await createRsvp(event, { isAttending: false })
    const { event: other } = await linkedEvent(owner)
    const foreign = await createRsvp(other)

    // Positivkontrolle: eigene Zusage -> Seating, mit frisch signiertem Link
    const ok = await open(request, event.id, confirmed.participant.editToken)
    const target = locationOf(ok)!
    expect(target.origin).toBe(TEST_SEATING_BASE_URL)
    expect(target.pathname).toBe(`/rsvp/${seatingEventId}`)
    expect(ok.headers()['cache-control']).toContain('no-store')
    const link = verifySigned(target.searchParams.get('t')!)
    expect(link).toMatchObject({
      typ: 'seat-link', aud: TEST_SEATING_BASE_URL, seatingEventId, rsvpEventId: event.id,
      rsvpId: confirmed.rsvp.id, name: 'Erika Muster', email: null, companions: ['Max']
    })
    expect((link.exp as number) - (link.iat as number)).toBeLessThanOrEqual(30 * 60)

    // Warteliste, Absage: zurück zur eigenen Event-Seite, nie zu Seating
    for (const [name, token] of [['Warteliste', waitlisted.participant.editToken], ['Absage', declined.participant.editToken]]) {
      const back = locationOf(await open(request, event.id, token))!
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.pathname, name).toBe(`/${event.slug}`)
    }
    // Fremder Token (Zusage eines ANDEREN verknüpften Events), erfundener Token, gar keiner
    for (const [name, token] of [['fremd', foreign.participant.editToken], ['erfunden', 'kein-echter-token'], ['ohne', undefined]]) {
      const back = locationOf(await open(request, event.id, token))!
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.searchParams.get('t'), name).toBeNull()
    }
    // Termin ohne Sitzplatz-Link: nie zu Seating
    const unlinked = await createEvent(owner)
    const plain = await createRsvp(unlinked)
    expect(locationOf(await open(request, unlinked.id, plain.participant.editToken))!.origin).toBe(BASE_URL)
  })

  test('bei Double-Opt-In erst nach der Verifizierung', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event } = await linkedEvent(owner, { requireVerification: true })
    const { participant } = await createRsvp(event)
    expect(locationOf(await open(request, event.id, participant.editToken))!.origin).toBe(BASE_URL)
    await prisma.participant.update({ where: { id: participant.id }, data: { isVerified: true, email: 'erika@example.test' } })
    const target = locationOf(await open(request, event.id, participant.editToken))!
    expect(target.origin).toBe(TEST_SEATING_BASE_URL)
    expect(verifySigned(target.searchParams.get('t')!)).toMatchObject({ email: 'erika@example.test' })
  })

  test('Gast-Session statt Token, mit Reihen-PIN', async ({ browser }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner, { eventPin: '1357' })
    const id = seatingId()
    const termin = await createTermin(series, { seatingUrl: seatingUrlFor(id) })
    const guest = await createGuestUser()
    const { rsvp } = await createRsvp(termin, { guestUserId: guest.id })

    const context = await browser.newContext()
    await plantGuestSession(context, guest)
    const page = await context.newPage()

    // Ohne PIN-Cookie: zurück zum Termin (die Seite zeigt dann das PIN-Formular)
    expect(locationOf(await open(page.request, termin.id, undefined, await cookieHeader(context)))!.origin).toBe(BASE_URL)
    await unlockPin(context, `series_pin_${series.id}`, '1357')
    const target = locationOf(await open(page.request, termin.id, undefined, await cookieHeader(context)))!
    expect(target.origin).toBe(TEST_SEATING_BASE_URL)
    expect(verifySigned(target.searchParams.get('t')!)).toMatchObject({ rsvpId: rsvp.id, rsvpEventId: termin.id, seatingEventId: id })

    // Ohne Session und ohne Token: nichts
    const anonymous = await browser.newContext()
    await unlockPin(anonymous, `series_pin_${series.id}`, '1357')
    const anonymousPage = await anonymous.newPage()
    expect(locationOf(await open(anonymousPage.request, termin.id, undefined, await cookieHeader(anonymous)))!.origin).toBe(BASE_URL)
    await context.close()
    await anonymous.close()
  })

  test('Button und "Dein Platz" auf der Gästeseite nur bei einer Zusage', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const { event } = await linkedEvent(owner)
    const confirmed = await createRsvp(event)
    await prisma.rsvp.update({ where: { id: confirmed.rsvp.id }, data: { seatingLabel: 'Tisch 7, Plätze 3, 4' } })
    const waitlisted = await createRsvp(event, { isOnWaitlist: true })

    await page.goto(`/${event.slug}?token=${confirmed.participant.editToken}`)
    await expect(page.getByText('Tisch 7, Plätze 3, 4')).toBeVisible()
    const button = page.getByRole('link', { name: /Sitzplatz/ })
    await expect(button).toHaveAttribute('href', `/api/seating-link/${event.id}?token=${confirmed.participant.editToken}`)

    await page.goto(`/${event.slug}?token=${waitlisted.participant.editToken}`)
    await expect(page.getByLabel('Dein Name')).toBeVisible()
    await expect(page.getByRole('link', { name: /Sitzplatz/ })).toHaveCount(0)
  })
})

test.describe('Gästeliste (/api/seating/guest-list)', () => {
  test('nur signiert, nur an sich selbst adressiert und nur für genau so verknüpfte Events', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner)
    const unlinked = await createEvent(owner)
    const valid = sign(envelope('guest-list-request', event, seatingEventId))
    const [payload, signature] = valid.split('.')

    const unauthorized: Record<string, string> = {
      'Signatur verändert': `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`,
      'falsches Secret': sign(envelope('guest-list-request', event, seatingEventId), 'ein-anderes-secret-0123456789abcdef0123'),
      'falscher Empfänger': sign(envelope('guest-list-request', event, seatingEventId, { aud: TEST_SEATING_BASE_URL })),
      'falsche Art': sign(envelope('placements', event, seatingEventId, { placements: [] })),
      'abgelaufen': sign(envelope('guest-list-request', event, seatingEventId, { exp: nowSeconds() - 5 })),
      'zu lange gültig': sign(envelope('guest-list-request', event, seatingEventId, { exp: nowSeconds() + 2 * 3600 })),
      'leer': '',
      'Unsinn': 'hallo welt'
    }
    for (const [name, body] of Object.entries(unauthorized)) {
      expect((await post(request, '/api/seating/guest-list', body)).status(), name).toBe(401)
    }

    const notLinked: Record<string, string> = {
      'Event ohne Sitzplatz-Link': sign(envelope('guest-list-request', unlinked, seatingEventId)),
      'anderes Seating-Event': sign(envelope('guest-list-request', event, seatingId())),
      'unbekanntes Event': sign({ ...envelope('guest-list-request', event, seatingEventId), rsvpEventId: 'cmunbekannt' + unique() })
    }
    for (const [name, body] of Object.entries(notLinked)) {
      const response = await post(request, '/api/seating/guest-list', body)
      expect(response.status(), name).toBe(404)
      expect(await response.text(), name).not.toContain('.')
    }

    const tooLarge = await post(request, '/api/seating/guest-list', 'x'.repeat(30_000))
    expect(tooLarge.status()).toBe(413)

    // Positivkontrolle
    expect((await post(request, '/api/seating/guest-list', valid)).status()).toBe(200)
  })

  test('liefert signiert genau die Zusagen, die zählen', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner, { requireVerification: true })
    const verified = await createRsvp(event, { name: 'Erika' })
    await prisma.participant.update({ where: { id: verified.participant.id }, data: { isVerified: true, email: 'erika@example.test' } })
    await prisma.rsvp.update({ where: { id: verified.rsvp.id }, data: { plusOne: true, plusOneName: null } })
    const unverified = await createRsvp(event)
    const waitlisted = await createRsvp(event, { isOnWaitlist: true })
    await prisma.participant.update({ where: { id: waitlisted.participant.id }, data: { isVerified: true } })
    const declined = await createRsvp(event, { isAttending: false })
    await prisma.participant.update({ where: { id: declined.participant.id }, data: { isVerified: true } })

    const response = await post(request, '/api/seating/guest-list', sign(envelope('guest-list-request', event, seatingEventId)))
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/plain')
    const list = verifySigned(await response.text())
    expect(list).toMatchObject({ typ: 'guest-list', aud: TEST_SEATING_BASE_URL, seatingEventId, rsvpEventId: event.id })
    expect(list.guests).toEqual([{ rsvpId: verified.rsvp.id, name: 'Erika', email: 'erika@example.test', companions: [null] }])
    expect(JSON.stringify(list)).not.toContain(unverified.rsvp.id)
  })
})

test.describe('Platzierungen (/api/seating/placements)', () => {
  const placements = (event: Event, seatingEventId: string, list: { rsvpId: string; label: string }[], overrides: Record<string, unknown> = {}) =>
    sign({ ...envelope('placements', event, seatingEventId, overrides), placements: list })
  const labelOf = async (rsvpId: string) => (await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvpId } })).seatingLabel

  test('setzen, leeren, ältere Meldung ignorieren, fremde Zusagen unberührt', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner)
    const a = await createRsvp(event)
    const b = await createRsvp(event)
    const { event: other } = await linkedEvent(owner)
    const foreign = await createRsvp(other)
    await prisma.rsvp.update({ where: { id: foreign.rsvp.id }, data: { seatingLabel: 'Tisch 99' } })

    // Angriffe ändern nichts
    expect((await post(request, '/api/seating/placements', placements(event, seatingEventId, [{ rsvpId: a.rsvp.id, label: 'X' }], { aud: TEST_SEATING_BASE_URL }))).status()).toBe(401)
    expect((await post(request, '/api/seating/placements', placements(event, seatingId(), [{ rsvpId: a.rsvp.id, label: 'X' }]))).status()).toBe(404)
    // Letztes Zeichen garantiert ändern (bei einer HMAC in base64url gibt es dort nur 16 mögliche Zeichen)
    const tampered = placements(event, seatingEventId, [{ rsvpId: a.rsvp.id, label: 'X' }]).replace(/.$/, last => (last === 'A' ? 'B' : 'A'))
    expect((await post(request, '/api/seating/placements', tampered)).status()).toBe(401)
    expect(await labelOf(a.rsvp.id)).toBeNull()

    // Setzen (die fremde rsvpId eines anderen Events wird ignoriert)
    const iat = nowSeconds()
    const set = await post(request, '/api/seating/placements', placements(event, seatingEventId, [
      { rsvpId: a.rsvp.id, label: 'Tisch 7, Plätze 3, 4' },
      { rsvpId: b.rsvp.id, label: 'Tisch 2' },
      { rsvpId: foreign.rsvp.id, label: 'Tisch 1' }
    ], { iat }))
    expect(set.status()).toBe(200)
    expect(await labelOf(a.rsvp.id)).toBe('Tisch 7, Plätze 3, 4')
    expect(await labelOf(b.rsvp.id)).toBe('Tisch 2')
    expect(await labelOf(foreign.rsvp.id)).toBe('Tisch 99')

    // Vollständiger Stand: nicht mehr genannte Zusagen werden geleert
    expect((await post(request, '/api/seating/placements', placements(event, seatingEventId, [{ rsvpId: a.rsvp.id, label: 'Tisch 8' }], { iat: iat + 1 }))).status()).toBe(200)
    expect(await labelOf(a.rsvp.id)).toBe('Tisch 8')
    expect(await labelOf(b.rsvp.id)).toBeNull()

    // Eine ältere Meldung, die erst jetzt ankommt, dreht den Stand nicht zurück
    expect((await post(request, '/api/seating/placements', placements(event, seatingEventId, [], { iat: iat - 30 }))).status()).toBe(200)
    expect(await labelOf(a.rsvp.id)).toBe('Tisch 8')

    // Leerer Stand (z.B. Event in Seating gelöscht) leert alles
    expect((await post(request, '/api/seating/placements', placements(event, seatingEventId, [], { iat: iat + 2 }))).status()).toBe(200)
    expect(await labelOf(a.rsvp.id)).toBeNull()
    expect(await labelOf(foreign.rsvp.id)).toBe('Tisch 99')
  })

  test('Anzeige beim Einlass und im CSV-Export', async ({ page, request }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner, { enableCheckin: true })
    const { rsvp } = await createRsvp(event, { name: 'Einlass-Gast' })
    expect((await post(request, '/api/seating/placements', placements(event, seatingEventId, [{ rsvpId: rsvp.id, label: 'Tisch 4, Platz 12' }]))).status()).toBe(200)

    await login(page, owner.email)
    await page.goto(`/admin/checkin/${rsvp.id}`)
    await expect(page.getByTestId('seating-label')).toHaveText('Tisch 4, Platz 12')

    const csv = await page.request.get(`/api/export?eventId=${event.id}`, { headers: await cookieHeader(page.context()) })
    expect(csv.status()).toBe(200)
    const [header, row] = (await csv.text()).replace('﻿', '').split('\n')
    expect(header.split(';')).toContain('Sitzplatz')
    expect(row).toContain('"Tisch 4, Platz 12"')
  })
})

test.describe('Webhook an Seating (rsvp-change)', () => {
  async function answer(page: Page, attending: boolean) {
    if (attending) await page.locator('input[name="isAttending"][value="true"]').check()
    else await page.locator('input[name="isAttending"][value="false"]').check()
    await page.getByRole('button', { name: /^(Antwort absenden|Änderungen speichern)$/ }).click()
  }

  test('Zusage, Absage und Löschen werden gemeldet', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const { event, seatingEventId } = await linkedEvent(owner)

    // Neue Zusage über das Formular -> attending true, und "Sitzplatz wählen" auf der Erfolgsseite
    await page.goto(`/${event.slug}`)
    await page.getByLabel('Dein Name').fill('Webhook-Gast')
    await answer(page, true)
    await expect(page.getByRole('link', { name: /Sitzplatz wählen/ })).toBeVisible()
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true } })
    await expect.poll(() => changesFor(rsvp.id).length).toBe(1)
    expect(changesFor(rsvp.id)[0]).toMatchObject({
      typ: 'rsvp-change', aud: TEST_SEATING_BASE_URL, seatingEventId, rsvpEventId: event.id,
      rsvpId: rsvp.id, attending: true, name: 'Webhook-Gast', companions: []
    })

    // Absage über den persönlichen Link -> attending false
    await page.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
    await answer(page, false)
    await expect(page.getByText('Deine Absage wurde erfolgreich gespeichert.')).toBeVisible()
    await expect.poll(() => changesFor(rsvp.id).length).toBe(2)
    expect(changesFor(rsvp.id)[1]).toMatchObject({ attending: false })

    // Wieder zusagen, dann löscht der Owner die Antwort -> zuletzt attending false
    await prisma.rsvp.update({ where: { id: rsvp.id }, data: { isAttending: true } })
    await login(page, owner.email)
    await page.goto('/admin')
    const deleteForm = await readForm(page, `form:has(input[name="rsvpId"][value="${rsvp.id}"]):has(button[title="Antwort löschen"])`)
    await submitForm(page, deleteForm)
    expect(await prisma.rsvp.findUnique({ where: { id: rsvp.id } })).toBeNull()
    await expect.poll(() => changesFor(rsvp.id).length).toBe(3)
    expect(changesFor(rsvp.id)[2]).toMatchObject({ attending: false, name: 'Webhook-Gast' })
  })
})
