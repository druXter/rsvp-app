import { createServer, type Server } from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { LINKED_CREATE, LINKED_CREATE_STATUS, verifyLinkedCreate, type LinkedCreateMessage } from 'suite-kit'
import { TEST_SHIFTS_BASE_URL, TEST_SHIFTS_SECRET } from '../../playwright.config'
import { TEST_TIMELINE_BASE_URL, TEST_TIMELINE_SECRET, createAccount, createEvent, login, prisma, readForm, submitForm } from './helpers'

// „Im Zeitplan anlegen“ / „In Schichten anlegen“ (Idee Q1, app/lib/linked-create.ts, Vertrag in suite-kit
// src/linked-create.ts). Ein Schein-Zeitplan und ein Schein-Schichten prüfen jede Nachricht mit suite-kit
// (verifyLinkedCreate, eigenes Secret je Tool) und antworten, wie es der Test vorgibt.

type Reply = (message: LinkedCreateMessage) => object
const received: { tool: string; message: LinkedCreateMessage }[] = []
const replies: Record<string, Reply> = {}
let servers: Server[] = []

function fakeTool(name: string, baseUrl: string, secret: string) {
  const origin = new URL(baseUrl).origin
  return new Promise<Server>(resolve => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const message = req.url === '/api/rsvp-create' ? verifyLinkedCreate(body, { audience: origin, secret }) : null
        if (!message) return res.writeHead(401).end()
        received.push({ tool: name, message })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(replies[name](message)))
      })
    })
    server.listen(Number(new URL(baseUrl).port), '127.0.0.1', () => resolve(server))
  })
}

const created = (origin: string, id: string, status = 'created') => ({ status, eventId: id, linkUrl: `${origin}/rsvp/${id}`, adminUrl: `${origin}/admin/events/${id}` })
const TIMELINE = new URL(TEST_TIMELINE_BASE_URL).origin
const SHIFTS = new URL(TEST_SHIFTS_BASE_URL).origin

test.beforeAll(async () => {
  servers = await Promise.all([
    fakeTool('timeline', TEST_TIMELINE_BASE_URL, TEST_TIMELINE_SECRET),
    fakeTool('shifts', TEST_SHIFTS_BASE_URL, TEST_SHIFTS_SECRET)
  ])
})

test.afterAll(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
})

test.beforeEach(() => {
  received.length = 0
  replies.timeline = () => ({ status: 'ready' })
  replies.shifts = () => ({ status: 'ready' })
})

async function openLinks(page: Page, eventId: string) {
  await page.goto(`/admin/events/${eventId}/einstellungen?abschnitt=verknuepfungen`)
}

test('Im Zeitplan anlegen: Nachricht mit Titel, Datum und Konto, Link eingetragen, Hinweis mit Link zum Event', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Winterball', date: new Date('2026-12-05T18:00:00Z') })
  await prisma.externalIdentity.create({ data: { issuer: TIMELINE, subject: 'zeitplankonto1', userId: owner.id } })
  replies.timeline = m => (m.kind === LINKED_CREATE ? created(TIMELINE, 'cmzeitplan123456') : { status: 'ready' })
  await login(page, owner.email)
  await openLinks(page, event.id)

  await page.getByRole('button', { name: 'Im Zeitplan anlegen' }).click()
  await expect(page.getByText('In Zeitplan angelegt und verknüpft')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In Zeitplan öffnen' })).toHaveAttribute('href', `${TIMELINE}/admin/events/cmzeitplan123456`)
  await expect(page.locator('#timelineUrl')).toHaveValue(`${TIMELINE}/rsvp/cmzeitplan123456`)
  // Verknüpft: kein Knopf mehr
  await expect(page.getByRole('button', { name: 'Im Zeitplan anlegen' })).toHaveCount(0)

  const link = await prisma.eventToolLink.findUniqueOrThrow({ where: { eventId_type: { eventId: event.id, type: 'timeline' } } })
  expect(link).toMatchObject({ url: `${TIMELINE}/rsvp/cmzeitplan123456`, remoteEventId: 'cmzeitplan123456' })
  const create = received.find(r => r.message.kind === LINKED_CREATE)!
  expect(create.tool).toBe('timeline')
  expect(create.message).toEqual({
    kind: LINKED_CREATE, title: 'Winterball', startsAt: new Date('2026-12-05T18:00:00Z'),
    request: { rsvpEventId: event.id, rsvpUserId: owner.id, toolUserId: 'zeitplankonto1' }
  })
  // Schichten bekam nur die Statusfrage, nichts angelegt
  expect(received.filter(r => r.tool === 'shifts').every(r => r.message.kind === LINKED_CREATE_STATUS)).toBe(true)
})

test('ohne Konto im Tool: Hinweis mit Anmelde-Link statt Knopf; nicht erreichbar: Hinweis', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  replies.timeline = () => ({ status: 'no-account', loginUrl: `${TIMELINE}/login` })
  replies.shifts = () => ({ status: 'kaputt' })
  await login(page, owner.email)
  await openLinks(page, event.id)
  await expect(page.getByRole('link', { name: /einmal im Zeitplan mit deinem Konto von hier anmelden/ })).toHaveAttribute('href', `${TIMELINE}/login`)
  await expect(page.getByRole('button', { name: 'Im Zeitplan anlegen' })).toHaveCount(0)
  await expect(page.getByText('Schichten ist gerade nicht erreichbar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'In Schichten anlegen' })).toHaveCount(0)
})

test('Antwort mit fremdem Link wird nicht gespeichert; Einladungsmodus ohne Schichten-Knopf', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  replies.shifts = m => (m.kind === LINKED_CREATE ? created('https://boese.example', 'cmboese1234567') : { status: 'ready' })
  await login(page, owner.email)
  await openLinks(page, event.id)
  await page.getByRole('button', { name: 'In Schichten anlegen' }).click()
  await expect(page.getByText('Anlegen in Schichten hat nicht geklappt')).toBeVisible()
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id } })).toBe(0)

  // Positivkontrolle: richtige Antwort wird gespeichert
  replies.shifts = m => (m.kind === LINKED_CREATE ? created(SHIFTS, 'cmschichten1234', 'linked') : created(SHIFTS, 'cmschichten1234', 'linked'))
  await openLinks(page, event.id)
  await page.getByRole('button', { name: 'Verknüpfen' }).click()
  await expect(page.getByText('Mit dem Event in Schichten verknüpft')).toBeVisible()
  expect((await prisma.eventToolLink.findFirstOrThrow({ where: { eventId: event.id, type: 'shifts' } })).remoteEventId).toBe('cmschichten1234')

  const invite = await createEvent(owner, { inviteOnly: true })
  await openLinks(page, invite.id)
  await expect(page.locator('#shiftsUrl')).toBeVisible()
  await expect(page.getByRole('button', { name: 'In Schichten anlegen' })).toHaveCount(0)
})

test('nur Owner und Admins: fremdes Konto und Moderator*in lösen nichts aus', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  replies.timeline = m => (m.kind === LINKED_CREATE ? created(TIMELINE, 'cmfremd12345678') : { status: 'ready' })
  await login(page, owner.email)
  await openLinks(page, event.id)
  const form = await readForm(page, '#linked-create-form')

  for (const role of ['CREATOR', 'MODERATOR'] as const) {
    const other = await createAccount(role)
    const otherPage = await browser.newPage()
    await login(otherPage, other.email)
    await submitForm(otherPage, form, { tool: 'timeline' })
    await otherPage.close()
  }
  expect(received.filter(r => r.message.kind === LINKED_CREATE)).toHaveLength(0)
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id } })).toBe(0)

  // Positivkontrolle: der Owner selbst
  await submitForm(page, form, { tool: 'timeline' })
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id, type: 'timeline' } })).toBe(1)
})
