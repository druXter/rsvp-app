import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import {
  FOREIGN_TOOL_BASE_URL, SEATING_PORT, TEST_SEATING_BASE_URL, createAccount, createEvent, createRsvp,
  decodeCouplingToken, linkTool, login, prisma, readForm, submitForm
} from './helpers'

// Verknüpfte Tools allgemein (app/lib/linked-tools.ts, Tabelle EventToolLink): Webhook nur an gültig
// verknüpfte Tools, Speichern und Entfernen der Verknüpfung im Termin-Formular. Den Vertrag mit
// Seating selbst prüft seating.spec.ts.


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

const seatingId = () => 'cmseat' + randomBytes(10).toString('hex')
const seatingUrlFor = (id: string) => `${TEST_SEATING_BASE_URL}/rsvp/${id}`
const messagesFor = (rsvpId: string) => received.map(r => decodeCouplingToken(r.body)).filter(m => m.rsvpId === rsvpId)

async function answerYes(page: Page, slug: string, name: string) {
  await page.goto(`/${slug}`)
  await page.getByLabel('Dein Name').fill(name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Deine Rückmeldung wurde erfolgreich gespeichert.')).toBeVisible()
}

test('Webhook geht nur an gültig verknüpfte, eingerichtete Tools', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  // Unbekannter Tool-Typ, dessen Link sogar auf das (Schein-)Seating zeigt: kein eingerichtetes Tool -> nichts
  const unknownType = await createEvent(owner)
  await linkTool(unknownType, 'unbekannt', seatingUrlFor(seatingId()))
  // Seating-Zeile mit fremdem Origin (am Formular vorbei in die DB geschrieben): gilt nie -> nichts
  const foreignOrigin = await createEvent(owner)
  await linkTool(foreignOrigin, 'seating', `${FOREIGN_TOOL_BASE_URL}/rsvp/${seatingId()}`)
  // Termin ohne Verknüpfung -> nichts
  const unlinked = await createEvent(owner)
  // Positivkontrolle: gültig mit Seating verknüpft
  const linked = await createEvent(owner)
  const seatingEventId = seatingId()
  await linkTool(linked, 'seating', seatingUrlFor(seatingEventId))

  for (const event of [unknownType, foreignOrigin, unlinked]) await answerYes(page, event.slug, `Ohne-${event.id}`)
  await answerYes(page, linked.slug, 'Mit-Verknuepfung')

  const linkedRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: linked.id } })
  await expect.poll(() => messagesFor(linkedRsvp.id).length).toBe(1)
  expect(messagesFor(linkedRsvp.id)[0]).toMatchObject({ typ: 'rsvp-change', seatingEventId, rsvpEventId: linked.id, attending: true })

  for (const event of [unknownType, foreignOrigin, unlinked]) {
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id } })
    expect(messagesFor(rsvp.id), event.id).toEqual([])
    expect(received.some(r => decodeCouplingToken(r.body).rsvpEventId === event.id), event.id).toBe(false)
  }
})

test('Termin-Formular: Verknüpfung speichern, ändern, entfernen - fremder Origin wird abgelehnt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const { rsvp, participant } = await createRsvp(event)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const linkOf = () => prisma.eventToolLink.findUnique({ where: { eventId_type: { eventId: event.id, type: 'seating' } } })
  const save = async (url: string) => submitForm(page, await readForm(page, 'form:has(input[name="seatingUrl"])'), { seatingUrl: url })

  // Fremder Origin (SSRF-Schutz) und falsche Form: nichts gespeichert
  await save(`${FOREIGN_TOOL_BASE_URL}/rsvp/${seatingId()}`)
  await save(`${TEST_SEATING_BASE_URL}/admin/${seatingId()}`)
  expect(await linkOf()).toBeNull()

  // Positivkontrolle: gültiger Link, kanonisch gespeichert
  const first = seatingId()
  expect((await save(`${seatingUrlFor(first)}/?x=1`)).status()).toBe(303)
  expect(await linkOf()).toMatchObject({ url: seatingUrlFor(first), remoteEventId: first })
  await page.goto(`/admin/edit/${event.id}`)
  await expect(page.locator('input[name="seatingUrl"]')).toHaveValue(seatingUrlFor(first))

  // Unverändert gespeichert: Plätze und Stand bleiben
  await prisma.eventToolLink.update({ where: { eventId_type: { eventId: event.id, type: 'seating' } }, data: { syncedAt: new Date() } })
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { seatingLabel: 'Tisch 1' } })
  await save(seatingUrlFor(first))
  expect((await linkOf())?.syncedAt).not.toBeNull()
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).seatingLabel).toBe('Tisch 1')

  // Anderes Seating-Event: Plätze und Stand des alten gelten nicht mehr
  const second = seatingId()
  await save(seatingUrlFor(second))
  expect(await linkOf()).toMatchObject({ remoteEventId: second, syncedAt: null })
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).seatingLabel).toBeNull()

  // Leer: Verknüpfung entfernt
  await save('')
  expect(await linkOf()).toBeNull()

  // Mit dem Event verschwindet auch seine Verknüpfung (onDelete: Cascade)
  await save(seatingUrlFor(first))
  expect(await linkOf()).not.toBeNull()
  await prisma.rsvp.deleteMany({ where: { eventId: event.id } })
  await prisma.participant.delete({ where: { id: participant.id } })
  await prisma.event.delete({ where: { id: event.id } })
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id } })).toBe(0)
})
