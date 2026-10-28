import { expect, test, type Browser, type Page } from '@playwright/test'
import type { User } from '@prisma/client'
import { BASE_URL, createAccount, createEvent, login, prisma, readForm, submitForm, unique, uniqueEmail } from './helpers'

// Gäste von Hand eintragen (Reiter „Gäste“, app/admin/manual-rsvp-actions.ts): Zusage, Vielleicht oder Absage mit
// optionaler Adresse, die nur mit Haken als bestätigt gilt. Es geht keine Mail raus.

const DAY = 24 * 60 * 60 * 1000

async function pageFor(browser: Browser, user: User | null): Promise<Page> {
  const page = await browser.newPage()
  if (user) {
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
  }
  return page
}

async function addGuest(page: Page, fields: { name: string; status: 'Zusage' | 'Vielleicht' | 'Absage'; email?: string; verified?: boolean }) {
  const panel = page.getByTestId('manual-rsvp')
  if (!(await panel.evaluate(el => (el as HTMLDetailsElement).open))) await panel.getByText('+ Gast eintragen').click()
  await panel.getByLabel('Name').fill(fields.name)
  await panel.getByLabel('Antwort').selectOption({ label: fields.status })
  await panel.getByLabel('E-Mail (optional)').fill(fields.email ?? '')
  await panel.getByLabel(/Adresse ist bestätigt/).setChecked(!!fields.verified)
  await panel.getByRole('button', { name: 'Eintragen' }).click()
}

test('Zusage, Vielleicht und Absage eintragen - Adresse nur mit Haken bestätigt, doppelte Adresse abgelehnt', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { allowMaybe: true, requireVerification: true, date: new Date(Date.now() + 10 * DAY) })
  const page = await pageFor(browser, owner)
  await page.goto(`/admin/events/${event.id}/gaeste`)

  const unverified = uniqueEmail('hand')
  await addGuest(page, { name: 'Ulla Unbestätigt', status: 'Zusage', email: unverified })
  await expect(page.getByTestId('manual-rsvp-saved')).toBeVisible()
  await addGuest(page, { name: 'Bea Bestätigt', status: 'Zusage', email: uniqueEmail('hand'), verified: true })
  await expect(page.getByTestId('guest-row')).toHaveCount(2)
  await addGuest(page, { name: 'Vito Vielleicht', status: 'Vielleicht', email: uniqueEmail('hand') })
  await expect(page.getByTestId('guest-row')).toHaveCount(3)
  await addGuest(page, { name: 'Anton Absage', status: 'Absage' })
  await expect(page.getByTestId('guest-row')).toHaveCount(4)

  const rows = await prisma.rsvp.findMany({ where: { eventId: event.id }, include: { participant: true } })
  const byName = (name: string) => rows.find(r => r.participant.name === name)!
  expect(byName('Ulla Unbestätigt')).toMatchObject({ isAttending: true, isOnWaitlist: false, isMaybe: false })
  expect(byName('Ulla Unbestätigt').participant).toMatchObject({ email: unverified, isVerified: false, verifiedAt: null })
  expect(byName('Bea Bestätigt').participant.isVerified).toBe(true)
  expect(byName('Bea Bestätigt').participant.verifiedAt).not.toBeNull()
  expect(byName('Vito Vielleicht')).toMatchObject({ isAttending: false, isMaybe: true })
  expect(byName('Vito Vielleicht').maybeRemindAt).not.toBeNull()
  expect(byName('Vito Vielleicht').participant.isVerified).toBe(false)
  expect(byName('Anton Absage')).toMatchObject({ isAttending: false, isMaybe: false, maybeRemindAt: null })
  expect(byName('Anton Absage').participant.email).toBeNull()

  // Nicht bestätigt mit Verifizierungs-Pflicht: wie bei einem Gast, der den Link noch nicht geklickt hat
  const ullaRow = page.getByTestId('guest-row').filter({ hasText: 'Ulla Unbestätigt' })
  await ullaRow.getByText('Details').click()
  await expect(ullaRow.getByText('Bestätigung ausstehend')).toBeVisible()

  // Dieselbe Adresse (andere Schreibweise) ein zweites Mal: Meldung, nichts gespeichert
  await addGuest(page, { name: 'Ulla Doppelt', status: 'Absage', email: unverified.toUpperCase() })
  await expect(page.getByTestId('settings-error')).toContainText('gibt es schon eine Antwort')
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(4)
  await page.close()
})

test('ohne „Vielleicht“ am Termin kein Vielleicht, im Einladungsmodus kein Formular', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const invite = await createEvent(owner, { inviteOnly: true })
  const page = await pageFor(browser, owner)

  await page.goto(`/admin/events/${event.id}/gaeste`)
  await page.getByText('+ Gast eintragen').click()
  await expect(page.getByLabel('Antwort').locator('option')).toHaveText(['Zusage', 'Absage'])
  const form = await readForm(page, '[data-testid="manual-rsvp"] form')
  await submitForm(page, form, { name: 'Erzwungen ' + unique(), status: 'maybe' })
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(0)
  // Positivkontrolle: dasselbe Formular mit Zusage wirkt
  await submitForm(page, form, { name: 'Erlaubt ' + unique(), status: 'yes' })
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(1)

  await page.goto(`/admin/events/${invite.id}/gaeste`)
  await expect(page.getByTestId('manual-rsvp')).toHaveCount(0)
  await submitForm(page, form, { eventId: invite.id, name: 'Uneingeladen ' + unique(), status: 'yes' })
  expect(await prisma.rsvp.count({ where: { eventId: invite.id } })).toBe(0)
  await page.close()
})

test('Rechte: fremdes Konto und ohne Sitzung wirkungslos, Moderator*in des Events schon', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const stranger = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEvent(owner)
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })

  const ownerPage = await pageFor(browser, owner)
  await ownerPage.goto(`/admin/events/${event.id}/gaeste`)
  const form = await readForm(ownerPage, '[data-testid="manual-rsvp"] form')

  const strangerPage = await pageFor(browser, stranger)
  await submitForm(strangerPage, form, { name: 'Fremd', status: 'yes' })
  const anonymous = await pageFor(browser, null)
  await submitForm(anonymous, form, { name: 'Anonym', status: 'yes' })
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(0)

  const modPage = await pageFor(browser, moderator)
  const response = await submitForm(modPage, form, { name: 'Von Moderation', status: 'yes' })
  expect(response.status()).toBeLessThan(400)
  const rsvps = await prisma.rsvp.findMany({ where: { eventId: event.id }, include: { participant: true } })
  expect(rsvps.map(r => r.participant.name)).toEqual(['Von Moderation'])
  for (const p of [ownerPage, strangerPage, anonymous, modPage]) await p.close()
})
