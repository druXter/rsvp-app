import { expect, test, type Browser, type Page } from '@playwright/test'
import type { User } from '@prisma/client'
import { BASE_URL, createAccount, createEvent, login, prisma, readForm, submitForm, uniqueEmail } from './helpers'

// Nachricht an Gäste (Idee L29, Reiter „Nachrichten“, app/admin/message-actions.ts): Auswahl mit Live-Zählung, Versand
// an die passenden Antworten, Verlauf; nur Owner und Admins; Grenze pro Tag.

async function pageFor(browser: Browser, user: User): Promise<Page> {
  const page = await browser.newPage()
  await login(page, user.email)
  await expect(page).toHaveURL(`${BASE_URL}/admin`)
  page.on('dialog', dialog => dialog.accept())
  return page
}

async function guest(eventId: string, data: { name: string; email?: string | null; verified?: boolean; isAttending?: boolean; isOnWaitlist?: boolean; isMaybe?: boolean; ticketCategoryId?: string }) {
  const participant = await prisma.participant.create({ data: { name: data.name, email: data.email === undefined ? uniqueEmail('gast') : data.email, isVerified: data.verified ?? true } })
  return prisma.rsvp.create({
    data: { eventId, participantId: participant.id, isAttending: data.isAttending ?? true, isOnWaitlist: data.isOnWaitlist ?? false, isMaybe: data.isMaybe ?? false, ticketCategoryId: data.ticketCategoryId ?? null }
  })
}

test('Auswahl zählt live mit, Versand an genau die Auswahl, Verlauf; Fehler lassen den Text stehen', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { enableCheckin: true })
  const studi = await prisma.ticketCategory.create({ data: { eventId: event.id, label: 'Studi', priceCents: 1500, position: 0 } })
  await guest(event.id, { name: 'Anna', ticketCategoryId: studi.id })
  await guest(event.id, { name: 'Ben' })
  await guest(event.id, { name: 'Cem ohne Adresse', email: null, verified: false })
  await guest(event.id, { name: 'Dora Warteliste', isOnWaitlist: true })
  await guest(event.id, { name: 'Emil Vielleicht', isAttending: false, isMaybe: true })
  await guest(event.id, { name: 'Fritz Vielleicht unbestätigt', isAttending: false, isMaybe: true, verified: false })
  await guest(event.id, { name: 'Gina Absage', isAttending: false })

  const page = await pageFor(browser, owner)
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('link', { name: 'Nachrichten' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/admin/events/${event.id}/nachrichten`)
  const count = page.getByTestId('message-count')
  await expect(count).toHaveText('3 Antworten · 2 per Mail, 1 ohne Adresse (nur Push)')
  await page.getByLabel('Warteliste').check()
  await page.getByLabel('Vielleicht').check()
  await expect(count).toContainText('5 Antworten · 4 per Mail')
  await page.getByLabel('Ticketkategorie').selectOption({ label: 'Studi' })
  await expect(count).toContainText('1 Antwort · 1 per Mail')
  await page.getByLabel('Ticketkategorie').selectOption({ label: 'Alle' })
  await page.getByLabel('Zusagen').uncheck()
  await expect(count).toContainText('2 Antworten · 2 per Mail')

  // Ohne Gruppe: nichts auswählbar
  await page.getByLabel('Warteliste').uncheck()
  await page.getByLabel('Vielleicht').uncheck()
  await expect(page.getByRole('button', { name: 'An 0 senden' })).toBeDisabled()

  await page.getByLabel('Zusagen').check()
  await page.getByLabel('Vielleicht').check()
  await page.getByLabel('Betreff').fill('Parkplatz gesperrt')
  await page.getByLabel('Text').fill('Bitte nehmt den Hintereingang.\n\nBis bald!')
  await page.getByRole('button', { name: 'An 4 senden' }).click()
  await expect(page.getByText('Nachricht „Parkplatz gesperrt“ an 4 verschickt')).toBeVisible()
  const message = await prisma.guestMessage.findFirstOrThrow({ where: { eventId: event.id } })
  // Ohne Mailserver in den Tests scheitert jede Mail - gezählt werden sie trotzdem alle
  expect(message).toMatchObject({ subject: 'Parkplatz gesperrt', body: 'Bitte nehmt den Hintereingang.\n\nBis bald!', recipients: 4, authorEmail: owner.email, audienceText: 'Zusagen, Vielleicht' })
  expect(message.mailSent + message.mailFailed).toBe(3)
  await expect(page.getByTestId('message-history')).toContainText('Parkplatz gesperrt')
  await expect(page.getByTestId('message-history')).toContainText('Zusagen, Vielleicht · 4 Empfänger*innen')

  // Zu langer Betreff (am Formular vorbei): Fehler, nichts verschickt
  const form = await readForm(page, '[data-testid="message-form"]')
  const tooLong = await submitForm(page, form, { subject: 'x'.repeat(151), body: 'Text', group_attending: 'on' })
  expect(tooLong.status()).toBeLessThan(400)
  expect(await prisma.guestMessage.count({ where: { eventId: event.id } })).toBe(1)
})

test('E-Mail-Bestätigung: nur bestätigte Adressen; Grenze von 10 Nachrichten pro Tag', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { requireVerification: true })
  await guest(event.id, { name: 'Bestätigt' })
  await guest(event.id, { name: 'Unbestätigt', verified: false })
  const page = await pageFor(browser, owner)
  await page.goto(`/admin/events/${event.id}/nachrichten`)
  await expect(page.getByTestId('message-count')).toHaveText('1 Antwort · 1 per Mail')

  await prisma.guestMessage.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ eventId: event.id, subject: `Alt ${i}`, body: 'x', audience: '{}', audienceText: 'Zusagen', recipients: 1, mailSent: 1, mailFailed: 0 })) })
  await page.reload()
  await page.getByLabel('Betreff').fill('Elfte')
  await page.getByLabel('Text').fill('Zu viel')
  await page.getByRole('button', { name: 'An 1 senden' }).click()
  await expect(page.getByTestId('message-error')).toContainText('Höchstens 10 Nachrichten pro Termin in 24 Stunden.')
  await expect(page.getByLabel('Text')).toHaveValue('Zu viel')
  expect(await prisma.guestMessage.count({ where: { eventId: event.id } })).toBe(10)
})

test('Nur Owner und Admins: Moderator*innen sehen den Reiter nicht und können nicht senden', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const admin = await createAccount('ADMIN')
  const event = await createEvent(owner)
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })
  await guest(event.id, { name: 'Anna' })

  const ownerPage = await pageFor(browser, owner)
  await ownerPage.goto(`/admin/events/${event.id}/nachrichten`)
  const form = await readForm(ownerPage, '[data-testid="message-form"]')
  const fields = { subject: 'Heimlich', body: 'Text', group_attending: 'on' }

  const modPage = await pageFor(browser, moderator)
  await modPage.goto(`/admin/events/${event.id}`)
  await expect(modPage.getByRole('link', { name: 'Gäste (1)' })).toBeVisible()
  await expect(modPage.getByRole('link', { name: 'Nachrichten' })).toHaveCount(0)
  expect((await modPage.goto(`/admin/events/${event.id}/nachrichten`))!.status()).toBe(404)
  await submitForm(modPage, form, fields)
  expect(await prisma.guestMessage.count({ where: { eventId: event.id } })).toBe(0)

  // Positivkontrolle: dieselbe Anfrage als Admin und als Owner geht durch
  const adminPage = await pageFor(browser, admin)
  await submitForm(adminPage, form, { ...fields, subject: 'Vom Admin' })
  await submitForm(ownerPage, form, { ...fields, subject: 'Vom Owner' })
  expect((await prisma.guestMessage.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } })).map(m => m.subject)).toEqual(['Vom Admin', 'Vom Owner'])
})
