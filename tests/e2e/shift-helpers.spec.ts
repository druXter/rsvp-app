import { expect, test } from '@playwright/test'
import { TEST_SHIFTS_BASE_URL, TEST_SHIFTS_SECRET } from '../../playwright.config'
import { createSignedMessage } from '../../app/lib/linked-tools'
import { BASE_URL, createAccount, createEvent, createRsvp, linkTool, login, pageAlert, prisma } from './helpers'

// Helfer-Zusagen aus Schichten (app/lib/shift-helpers.ts, -store.ts, /api/shifts/helpers): Stufen nach Zahl der
// Schichten, feste Zusagen auch bei vollem Termin, Absage unter der ersten Stufe (bezahlte bleiben), eigene Zusagen
// derselben Adresse bleiben unangetastet, alte Meldungen werden verworfen, Gäste sagen Helfer-Zusagen nicht ab.

const SHIFTS_EVENT = 'cmshiftsevente2e01'
let seq = Date.now()

function message(rsvpEventId: string, helpers: object[], options: { secret?: string; aud?: string; shiftsEventId?: string; seq?: number } = {}) {
  return createSignedMessage('shift-helpers', {
    aud: options.aud ?? new URL(BASE_URL).origin, shiftsEventId: options.shiftsEventId ?? SHIFTS_EVENT, rsvpEventId,
    seq: options.seq ?? ++seq, helpers
  }, options.secret ?? TEST_SHIFTS_SECRET)
}

const helper = (id: string, name: string, shifts: number) => ({ helperId: `cmhelper${id.padEnd(9, '0')}`, name, email: `${name.toLowerCase()}-${id}@example.test`, shifts })

async function setup() {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Winterball', maxCapacity: 1, paymentRecipient: 'AStA', paymentIban: 'DE89370400440532013000' })
  const helfer = await prisma.ticketCategory.create({ data: { eventId: event.id, label: 'Helfer*innen', priceCents: 0, position: 0 } })
  const plus = await prisma.ticketCategory.create({ data: { eventId: event.id, label: 'Helfer*innen plus', priceCents: 500, position: 1 } })
  await prisma.event.update({ where: { id: event.id }, data: { shiftTiers: JSON.stringify([{ min: 1, categoryId: helfer.id }, { min: 3, categoryId: plus.id }]) } })
  await linkTool(event, 'shifts', `${TEST_SHIFTS_BASE_URL}/rsvp/${SHIFTS_EVENT}`)
  // Der Termin ist voll (Kapazität 1) - Helfer*innen kommen trotzdem fest hinein
  await createRsvp(event, { name: 'Gast' })
  return { owner, event, helfer, plus }
}

async function post(request: import('@playwright/test').APIRequestContext, body: string) {
  return request.post('/api/shifts/helpers', { data: body, headers: { 'content-type': 'text/plain' } })
}

test('Stufen: neue Zusagen fest trotz vollem Termin, Wechsel der Kategorie, Absage unter der ersten Stufe, bezahlte bleiben', async ({ request }) => {
  const { event, helfer, plus } = await setup()
  const anna = helper('anna', 'Anna', 1)
  const ben = helper('ben', 'Ben', 4)
  const zero = helper('zero', 'Null', 0)

  const first = await post(request, message(event.id, [anna, ben, zero]))
  expect(first.status()).toBe(200)
  expect(await first.json()).toMatchObject({ outcome: 'applied', conflicts: [] })
  const rows = await prisma.rsvp.findMany({ where: { eventId: event.id, shiftHelperId: { not: null } }, include: { participant: true }, orderBy: { shiftCount: 'asc' } })
  expect(rows.map(r => [r.participant.name, r.ticketCategoryId, r.isAttending, r.isOnWaitlist, r.shiftCount, r.amountCents])).toEqual([
    ['Anna', helfer.id, true, false, 1, null],
    ['Ben', plus.id, true, false, 4, 500]
  ])
  const benRsvp = rows[1]
  expect(benRsvp.paymentReference).toMatch(/^[A-Z0-9]+-[A-Z0-9]{8}$/)
  expect(benRsvp.participant).toMatchObject({ email: ben.email, isVerified: true })

  // Anna steigt auf (3 Schichten), Ben fällt auf 0 - aber bezahlt: bleibt; Anna später auf 0: Absage
  await prisma.rsvp.update({ where: { id: benRsvp.id }, data: { paidAt: new Date() } })
  await post(request, message(event.id, [{ ...anna, shifts: 3 }, { ...ben, shifts: 0 }]))
  const annaRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id, shiftHelperId: anna.helperId } })
  expect(annaRsvp).toMatchObject({ ticketCategoryId: plus.id, amountCents: 500, shiftCount: 3, isAttending: true })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: benRsvp.id } })).toMatchObject({ isAttending: true, ticketCategoryId: plus.id, shiftCount: 0 })

  await post(request, message(event.id, [{ ...ben, shifts: 0 }]))
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: annaRsvp.id } })).toMatchObject({ isAttending: false, shiftCount: 0 })

  // Wieder genug Schichten: wieder fest
  await post(request, message(event.id, [{ ...anna, shifts: 1 }]))
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: annaRsvp.id } })).toMatchObject({ isAttending: true, isOnWaitlist: false, ticketCategoryId: helfer.id, amountCents: null })
})

test('Konflikt mit eigener Zusage, veraltete Meldung, Signatur, Empfänger und Verknüpfung', async ({ request }) => {
  const { event } = await setup()
  const own = await createRsvp(event, { name: 'Clara' })
  const clara = helper('clara', 'Clara', 2)
  await prisma.participant.update({ where: { id: own.participant.id }, data: { email: clara.email } })

  const response = await post(request, message(event.id, [clara]))
  expect(await response.json()).toMatchObject({ outcome: 'applied', conflicts: [clara.helperId] })
  expect(await prisma.rsvp.count({ where: { eventId: event.id, shiftHelperId: clara.helperId } })).toBe(0)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: own.rsvp.id } })).toMatchObject({ shiftHelperId: null, isAttending: true })

  // Ältere Meldung (kleinere seq) nach einer neueren: verworfen
  const dora = helper('dora', 'Dora', 1)
  const older = message(event.id, [dora], { seq: seq - 1000 })
  await post(request, message(event.id, []))
  expect(await (await post(request, older)).json()).toMatchObject({ outcome: 'stale' })
  expect(await prisma.rsvp.count({ where: { eventId: event.id, shiftHelperId: dora.helperId } })).toBe(0)

  // Falsches Secret, falscher Empfänger: 401. Fremdes Schichten-Event oder unverknüpfter Termin: 404.
  expect((await post(request, message(event.id, [dora], { secret: 'x'.repeat(40) }))).status()).toBe(401)
  expect((await post(request, message(event.id, [dora], { aud: 'https://evil.example' }))).status()).toBe(401)
  expect((await post(request, message(event.id, [dora], { shiftsEventId: 'cmanderesevent0001' }))).status()).toBe(404)
  const other = await createEvent(await createAccount('CREATOR'))
  expect((await post(request, message(other.id, [dora]))).status()).toBe(404)
  expect(await prisma.rsvp.count({ where: { shiftHelperId: dora.helperId } })).toBe(0)
  // Positivkontrolle
  expect((await post(request, message(event.id, [dora]))).status()).toBe(200)
  expect(await prisma.rsvp.count({ where: { eventId: event.id, shiftHelperId: dora.helperId } })).toBe(1)
})

test('Gast mit Helfer-Zusage: Hinweis statt Absage, Absage auch per manipuliertem Formular abgelehnt; Gästeliste zeigt Schichten', async ({ page, request }) => {
  const { owner, event } = await setup()
  const eva = helper('eva', 'Eva', 2)
  await post(request, message(event.id, [eva]))
  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id, shiftHelperId: eva.helperId }, include: { participant: true } })

  await page.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
  await expect(page.getByTestId('shift-managed')).toContainText('als Helfer*in dabei (2 Schichten)')
  await expect(page.getByRole('radio', { name: 'Nein, leider nicht' })).toHaveCount(0)
  // Manipuliert: isAttending=false mitschicken
  await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('input[type="hidden"][name="isAttending"]'); if (input) input.value = 'false' })
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(pageAlert(page)).toContainText('Deine Zusage kommt von deinen Schichten')
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).isAttending).toBe(true)

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/gaeste`)
  await expect(page.getByTestId('guest-row').filter({ hasText: 'Eva' })).toContainText('Helfer*in · 2 Schichten')
})

test('Einstellungen: Schichten-Link und Stufen speichern; nicht zusammen mit „Nur mit Einladung“', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await prisma.ticketCategory.create({ data: { eventId: event.id, label: 'Helfer*innen', priceCents: 0, position: 0 } })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await page.locator('summary').filter({ hasText: 'Verknüpfungen' }).click()
  await page.locator('#shiftsUrl').fill(`${TEST_SHIFTS_BASE_URL}/rsvp/${SHIFTS_EVENT}`)
  await page.locator('#shiftTiers').fill('1: Unbekannt')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByTestId('settings-error')).toContainText('fehlt eine der Kategorien')
  await page.locator('#shiftTiers').fill('1: helfer*innen')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(/gespeichert=1/)
  const saved = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { toolLinks: true, ticketCategories: true } })
  expect(saved.toolLinks.map(l => [l.type, l.remoteEventId])).toEqual([['shifts', SHIFTS_EVENT]])
  expect(JSON.parse(saved.shiftTiers!)).toEqual([{ min: 1, categoryId: saved.ticketCategories[0].id }])

  // Einladungsmodus sperrt: im Formular und auf dem Server (Kategorien vorher entfernen, die sperren ebenfalls)
  await prisma.ticketCategory.deleteMany({ where: { eventId: event.id } })
  await prisma.event.update({ where: { id: event.id }, data: { inviteOnly: true, shiftTiers: null } })
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await page.locator('summary').filter({ hasText: 'Verknüpfungen' }).click()
  await expect(page.getByTestId('rule-shiftsUrl')).toContainText('Geht nicht zusammen')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByTestId('settings-error')).toContainText('nicht zusammen mit „Nur mit Einladung“')
})
