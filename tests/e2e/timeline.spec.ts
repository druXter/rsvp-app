import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Event, User } from '@prisma/client'
import {
  BASE_URL, FOREIGN_TOOL_BASE_URL, SEATING_PORT, TEST_SEATING_BASE_URL, TEST_SEATING_SECRET, TEST_TIMELINE_BASE_URL,
  TEST_TIMELINE_SECRET, TIMELINE_PORT, createAccount, createEvent, createRsvp, decodeCouplingToken, linkTool, locationOf,
  login, prisma, readForm, submitForm
} from './helpers'

// Kopplung mit dem Zeitplan-Tool (app/lib/timeline.ts, Gegenstück dort app/lib/rsvp/token.ts). Alle
// Nachrichten tragen base64url(JSON).base64url(HMAC-SHA256) mit dem EIGENEN TIMELINE_SECRET. Geprüft
// werden der Button "Zeitplan" samt Weiterleitung (/api/timeline-link/[eventId]), der Webhook an Zeitplan
// und das Feld "Zeitplan-Link" im Termin-Formular. Für die Webhooks laufen hier ein Schein-Zeitplan
// und ein Schein-Seating, die jede Meldung mitschreiben - so ist sichtbar, welches Tool was bekommt.

type Received = { path: string; body: string }
const toZeitplan: Received[] = []
const toSeating: Received[] = []
let servers: Server[] = []

function recorder(port: number, into: Received[]) {
  return new Promise<Server>(resolve => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        into.push({ path: req.url ?? '', body })
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

test.beforeAll(async () => {
  servers = await Promise.all([recorder(TIMELINE_PORT, toZeitplan), recorder(SEATING_PORT, toSeating)])
})

test.afterAll(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
})

const remoteId = (prefix: string) => prefix + randomBytes(10).toString('hex')
const timelineUrlFor = (id: string) => `${TEST_TIMELINE_BASE_URL}/rsvp/${id}`

async function linkedEvent(owner: User, data: Partial<Event> = {}) {
  const timelineEventId = remoteId('cmzeit')
  const event = await createEvent(owner, data)
  await linkTool(event, 'timeline', timelineUrlFor(timelineEventId))
  return { event, timelineEventId }
}

/** Prüft die Signatur mit dem Secret des Zeitplans - und dass sie mit dem von Seating NICHT stimmt. */
function verifyTimeline(token: string) {
  const [payload, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_TIMELINE_SECRET).update(payload).digest('base64url'))
  expect(signature).not.toBe(createHmac('sha256', TEST_SEATING_SECRET).update(payload).digest('base64url'))
  return decodeCouplingToken(token)
}

const webhooksFor = (list: Received[], rsvpId: string) => list
  .filter(r => r.path === '/api/rsvp-webhook')
  .map(r => decodeCouplingToken(r.body))
  .filter(m => m.rsvpId === rsvpId)

const open = (request: APIRequestContext, eventId: string, token?: string) =>
  request.get(`/api/timeline-link/${eventId}${token ? `?token=${encodeURIComponent(token)}` : ''}`, { maxRedirects: 0 })

test.describe('Zeitplan öffnen (/api/timeline-link)', () => {
  test('nur für die eigene, gültige Zusage - frisch signiert mit TIMELINE_SECRET, richtige Felder, 303', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event, timelineEventId } = await linkedEvent(owner)
    const confirmed = await createRsvp(event, { name: 'Erika Muster' })
    const waitlisted = await createRsvp(event, { isOnWaitlist: true })
    const declined = await createRsvp(event, { isAttending: false })
    const { event: other } = await linkedEvent(owner)
    const foreign = await createRsvp(other)

    // Positivkontrolle
    const ok = await open(request, event.id, confirmed.participant.editToken)
    expect(ok.status()).toBe(303)
    expect(ok.headers()['cache-control']).toContain('no-store')
    expect(ok.headers()['referrer-policy']).toBe('no-referrer')
    const target = locationOf(ok)!
    expect(target.origin).toBe(TEST_TIMELINE_BASE_URL)
    expect(target.pathname).toBe(`/rsvp/${timelineEventId}`)
    expect([...target.searchParams.keys()]).toEqual(['t'])
    const link = verifyTimeline(target.searchParams.get('t')!)
    expect(link).toEqual({
      typ: 'timeline-link', aud: TEST_TIMELINE_BASE_URL, timelineEventId, rsvpEventId: event.id, rsvpId: confirmed.rsvp.id,
      iat: expect.any(Number), exp: expect.any(Number)
    })
    const now = Math.floor(Date.now() / 1000)
    expect(Math.abs((link.iat as number) - now)).toBeLessThan(60)
    expect((link.exp as number) - (link.iat as number)).toBe(600)

    // Bei jedem Klick neu ausgestellt
    await new Promise(resolve => setTimeout(resolve, 1100))
    const again = locationOf(await open(request, event.id, confirmed.participant.editToken))!
    expect(again.searchParams.get('t')).not.toBe(target.searchParams.get('t'))

    // Warteliste, Absage: zurück zur eigenen Event-Seite
    for (const [name, token] of [['Warteliste', waitlisted.participant.editToken], ['Absage', declined.participant.editToken]]) {
      const back = locationOf(await open(request, event.id, token))!
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.pathname, name).toBe(`/${event.slug}`)
    }
    // Fremder Token (Zusage eines anderen verknüpften Termins), erfundener, gar keiner
    for (const [name, token] of [['fremd', foreign.participant.editToken], ['erfunden', 'kein-echter-token'], ['ohne', undefined]]) {
      const back = locationOf(await open(request, event.id, token))!
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.searchParams.get('t'), name).toBeNull()
    }
  })

  test('bei Double-Opt-In erst nach der Verifizierung', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const { event } = await linkedEvent(owner, { requireVerification: true })
    const { participant } = await createRsvp(event)
    expect(locationOf(await open(request, event.id, participant.editToken))!.origin).toBe(BASE_URL)
    await prisma.participant.update({ where: { id: participant.id }, data: { isVerified: true } })
    expect(locationOf(await open(request, event.id, participant.editToken))!.origin).toBe(TEST_TIMELINE_BASE_URL)
  })

  test('Termin ohne Zeitplan-Link (auch nur mit Seating verknüpft): nie zum Zeitplan', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const unlinked = await createEvent(owner)
    const plain = await createRsvp(unlinked)
    expect(locationOf(await open(request, unlinked.id, plain.participant.editToken))!.origin).toBe(BASE_URL)

    const seatingOnly = await createEvent(owner)
    await linkTool(seatingOnly, 'seating', `${TEST_SEATING_BASE_URL}/rsvp/${remoteId('cmseat')}`)
    const seated = await createRsvp(seatingOnly)
    const back = locationOf(await open(request, seatingOnly.id, seated.participant.editToken))!
    expect(back.origin).toBe(BASE_URL)
    // Positivkontrolle für denselben Termin über die Seating-Route
    expect(locationOf(await request.get(`/api/seating-link/${seatingOnly.id}?token=${seated.participant.editToken}`, { maxRedirects: 0 }))!.origin)
      .toBe(TEST_SEATING_BASE_URL)

    // Zeile vom Typ "timeline", deren Adresse nicht TIMELINE_BASE_URL ist (am Formular vorbei): gilt nie
    const foreign = await createEvent(owner)
    await linkTool(foreign, 'timeline', `${FOREIGN_TOOL_BASE_URL}/rsvp/${remoteId('cmzeit')}`)
    const foreignRsvp = await createRsvp(foreign)
    expect(locationOf(await open(request, foreign.id, foreignRsvp.participant.editToken))!.origin).toBe(BASE_URL)
  })

  test('Button "Zeitplan" auf der Gästeseite nur bei einer gültigen Zusage', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const { event } = await linkedEvent(owner)
    const confirmed = await createRsvp(event)
    const waitlisted = await createRsvp(event, { isOnWaitlist: true })

    await page.goto(`/${event.slug}?token=${confirmed.participant.editToken}`)
    await expect(page.getByRole('link', { name: /Zeitplan/ })).toHaveAttribute('href', `/api/timeline-link/${event.id}?token=${confirmed.participant.editToken}`)

    await page.goto(`/${event.slug}?token=${waitlisted.participant.editToken}`)
    await expect(page.getByLabel('Dein Name')).toBeVisible()
    await expect(page.getByRole('link', { name: /Zeitplan/ })).toHaveCount(0)
  })
})

test.describe('Webhook an Zeitplan (rsvp-change)', () => {
  async function answer(page: Page, attending: boolean) {
    await page.locator(`input[name="isAttending"][value="${attending}"]`).check()
    await page.getByRole('button', { name: /^(Antwort absenden|Änderungen speichern)$/ }).click()
  }

  test('Zusage, Absage und Löschen gehen an genau die verknüpften Tools - an Zeitplan ohne Namen', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    // Mit Zeitplan UND Seating verknüpft: jedes Tool bekommt seine eigene Nachricht
    const { event, timelineEventId } = await linkedEvent(owner)
    const seatingEventId = remoteId('cmseat')
    await linkTool(event, 'seating', `${TEST_SEATING_BASE_URL}/rsvp/${seatingEventId}`)

    await page.goto(`/${event.slug}`)
    await page.getByLabel('Dein Name').fill('Zeitplan-Gast')
    await answer(page, true)
    // Erfolgsseite zeigt den Button
    await expect(page.getByRole('link', { name: /Zeitplan/ })).toBeVisible()
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true } })

    await expect.poll(() => webhooksFor(toZeitplan, rsvp.id).length).toBe(1)
    const first = toZeitplan.find(r => decodeCouplingToken(r.body).rsvpId === rsvp.id)!
    expect(verifyTimeline(first.body)).toEqual({
      typ: 'rsvp-change', aud: TEST_TIMELINE_BASE_URL, timelineEventId, rsvpEventId: event.id, rsvpId: rsvp.id, attending: true,
      iat: expect.any(Number), exp: expect.any(Number)
    })
    await expect.poll(() => webhooksFor(toSeating, rsvp.id).length).toBe(1)
    expect(webhooksFor(toSeating, rsvp.id)[0]).toMatchObject({ seatingEventId, name: 'Zeitplan-Gast' })

    // Absage über den persönlichen Link -> attending false an Zeitplan
    await page.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
    await answer(page, false)
    await expect(page.getByText('Deine Absage wurde erfolgreich gespeichert.')).toBeVisible()
    await expect.poll(() => webhooksFor(toZeitplan, rsvp.id).length).toBe(2)
    expect(webhooksFor(toZeitplan, rsvp.id)[1]).toMatchObject({ attending: false, timelineEventId })

    // Wieder zusagen, dann löscht der Owner die Antwort -> zuletzt attending false
    await prisma.rsvp.update({ where: { id: rsvp.id }, data: { isAttending: true } })
    await login(page, owner.email)
    await page.goto('/admin')
    const deleteForm = await readForm(page, `form:has(input[name="rsvpId"][value="${rsvp.id}"]):has(button[title="Antwort löschen"])`)
    await submitForm(page, deleteForm)
    expect(await prisma.rsvp.findUnique({ where: { id: rsvp.id } })).toBeNull()
    await expect.poll(() => webhooksFor(toZeitplan, rsvp.id).length).toBe(3)
    expect(webhooksFor(toZeitplan, rsvp.id)[2]).toMatchObject({ attending: false })
  })

  test('nicht mit Zeitplan verknüpfte Termine: Zeitplan bekommt nichts', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const unlinked = await createEvent(owner)
    const seatingOnly = await createEvent(owner)
    await linkTool(seatingOnly, 'seating', `${TEST_SEATING_BASE_URL}/rsvp/${remoteId('cmseat')}`)
    // Positivkontrolle zum Schluss: ein mit Zeitplan verknüpfter Termin
    const { event: linked } = await linkedEvent(owner)

    for (const event of [unlinked, seatingOnly, linked]) {
      await page.goto(`/${event.slug}`)
      await page.getByLabel('Dein Name').fill(`Gast-${event.id}`)
      await answer(page, true)
      await expect(page.getByText('Deine Rückmeldung wurde erfolgreich gespeichert.')).toBeVisible()
    }

    const linkedRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: linked.id } })
    await expect.poll(() => webhooksFor(toZeitplan, linkedRsvp.id).length).toBe(1)
    const seatingRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: seatingOnly.id } })
    await expect.poll(() => webhooksFor(toSeating, seatingRsvp.id).length).toBe(1)

    for (const event of [unlinked, seatingOnly]) {
      expect(toZeitplan.some(r => decodeCouplingToken(r.body).rsvpEventId === event.id), event.id).toBe(false)
    }
    expect(toSeating.some(r => decodeCouplingToken(r.body).rsvpEventId === linked.id)).toBe(false)
  })
})

test('Termin-Formular: Zeitplan-Link speichern und entfernen, fremde Adressen abgelehnt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const linkOf = () => prisma.eventToolLink.findUnique({ where: { eventId_type: { eventId: event.id, type: 'timeline' } } })
  const save = async (url: string) => submitForm(page, await readForm(page, 'form:has(input[name="timelineUrl"])'), { timelineUrl: url })

  // Fremder Origin, Seatings Adresse (anderes Tool) und falsche Form: nichts gespeichert
  await save(`${FOREIGN_TOOL_BASE_URL}/rsvp/${remoteId('cmzeit')}`)
  await save(`${TEST_SEATING_BASE_URL}/rsvp/${remoteId('cmzeit')}`)
  await save(`${TEST_TIMELINE_BASE_URL}/admin/${remoteId('cmzeit')}`)
  expect(await linkOf()).toBeNull()

  // Positivkontrolle
  const id = remoteId('cmzeit')
  expect((await save(`${timelineUrlFor(id)}?x=1`)).status()).toBe(303)
  expect(await linkOf()).toMatchObject({ url: timelineUrlFor(id), remoteEventId: id })
  await page.goto(`/admin/edit/${event.id}`)
  await expect(page.locator('input[name="timelineUrl"]')).toHaveValue(timelineUrlFor(id))
  // Der Seating-Link bleibt davon unberührt (eigene Zeile je Tool)
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id, type: 'seating' } })).toBe(0)

  await save('')
  expect(await linkOf()).toBeNull()
})
