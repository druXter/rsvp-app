import { expect, test, type Browser } from '@playwright/test'
import type { GuestUser } from '@prisma/client'
import { createAccount, createEvent, createGuestUser, plantGuestSession, prisma } from './helpers'

// Wer angemeldet ist, antwortet immer mit seinem Konto (app/lib/account-participant.ts) - auch bei Einzel-Events ohne
// Konto-Pflicht. Eine frühere Antwort ohne Konto mit genau der Adresse des Kontos wird übernommen, keine zweite Antwort.

const FORM = JSON.stringify({ askEmail: true, askPhone: false, askDiet: false, askAlcohol: false })
const DAY = 24 * 60 * 60 * 1000

async function asGuest(browser: Browser, guest: GuestUser) {
  const context = await browser.newContext()
  await plantGuestSession(context, guest)
  return context.newPage()
}

test('angemeldet bei einem offenen Einzel-Event: vorausgefüllt, Antwort am Konto, in Mein Konto', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Offenes Fest', formConfig: FORM, date: new Date(Date.now() + 3 * DAY) })
  const guest = await createGuestUser()
  const page = await asGuest(browser, guest)
  await page.goto(`/${event.slug}`)
  await expect(page.getByLabel('Dein Name')).toHaveValue(guest.name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()

  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true } })
  expect(rsvp.participant).toMatchObject({ guestUserId: guest.id, email: guest.email, isVerified: true })
  await page.goto('/mein-konto')
  await expect(page.getByTestId('other-events').locator('a', { hasText: 'Offenes Fest' })).toContainText('Zugesagt')

  // Erneut: dieselbe Antwort wird geändert, keine zweite
  await page.goto(`/${event.slug}`)
  await page.locator('input[name="isAttending"][value="false"]').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(async () => (await prisma.rsvp.findMany({ where: { eventId: event.id } })).map(r => r.isAttending)).toEqual([false])
})

test('frühere Antwort ohne Konto mit derselben Adresse wird übernommen, mit anderer nicht', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Früh geantwortet', formConfig: FORM, date: new Date(Date.now() + 3 * DAY) })
  const guest = await createGuestUser()
  // Ohne Konto geantwortet - mit Großbuchstaben in der Adresse, unbestätigt
  const anonymous = await prisma.participant.create({ data: { name: 'Anonym', email: guest.email.toUpperCase(), isVerified: false } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: anonymous.id, isAttending: true } })
  const stranger = await prisma.participant.create({ data: { name: 'Jemand', email: 'andere@example.test' } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: stranger.id, isAttending: true } })

  const page = await asGuest(browser, guest)
  await page.goto(`/${event.slug}`)
  // Die frühere Antwort ist da (Ansehen übernimmt noch nichts)
  await expect(page.getByLabel('Dein Name')).toHaveValue('Anonym')
  expect((await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })).guestUserId).toBeNull()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(async () => (await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })).guestUserId).toBe(guest.id)
  expect(await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })).toMatchObject({ isVerified: true })
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(2)
  expect((await prisma.participant.findUniqueOrThrow({ where: { id: stranger.id } })).guestUserId).toBeNull()
})
