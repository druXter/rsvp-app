import { expect, test, type Browser } from '@playwright/test'
import type { GuestUser } from '@prisma/client'
import { createAccount, createEvent, createGuestUser, plantGuestSession, prisma } from './helpers'

// Wer angemeldet ist, antwortet immer mit seinem Konto (app/lib/account-participant.ts) - auch bei Einzel-Events ohne
// Konto-Pflicht. Eine frühere Antwort ohne Konto mit genau der Adresse des Kontos wird übernommen, wenn diese Adresse dort bestätigt
// wurde - keine zweite Antwort.

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

test('frühere Antwort ohne Konto mit derselben, bestätigten Adresse wird übernommen, mit anderer oder unbestätigter nicht', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Früh geantwortet', formConfig: FORM, date: new Date(Date.now() + 3 * DAY) })
  const guest = await createGuestUser()
  // Ohne Konto geantwortet - mit Großbuchstaben in der Adresse, dort bestätigt
  const anonymous = await prisma.participant.create({ data: { name: 'Anonym', email: guest.email.toUpperCase(), isVerified: true, verifiedAt: new Date() } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: anonymous.id, isAttending: true } })
  await prisma.participantPushSubscription.create({ data: { participantId: anonymous.id, endpoint: 'https://push.example.test/alt', p256dh: 'x', auth: 'y' } })
  const stranger = await prisma.participant.create({ data: { name: 'Jemand', email: 'andere@example.test' } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: stranger.id, isAttending: true } })

  const page = await asGuest(browser, guest)
  await page.goto(`/${event.slug}`)
  // Die frühere Antwort ist da (Ansehen übernimmt noch nichts)
  await expect(page.getByLabel('Dein Name')).toHaveValue('Anonym')
  expect((await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })).guestUserId).toBeNull()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(async () => (await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })).guestUserId).toBe(guest.id)
  // Neuer persönlicher Link, die Push-Abos des alten sind weg - beides gehörte dem, der die Antwort angelegt hat
  const adopted = await prisma.participant.findUniqueOrThrow({ where: { id: anonymous.id } })
  expect(adopted).toMatchObject({ isVerified: true })
  expect(adopted.editToken).not.toBe(anonymous.editToken)
  expect(await prisma.participantPushSubscription.count({ where: { participantId: anonymous.id } })).toBe(0)
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(2)
  expect((await prisma.participant.findUniqueOrThrow({ where: { id: stranger.id } })).guestUserId).toBeNull()
})

test('frühere Antwort ohne Konto mit derselben, aber nie bestätigten Adresse bleibt unberührt', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Fremd angelegt', formConfig: FORM, date: new Date(Date.now() + 3 * DAY) })
  const guest = await createGuestUser()
  // Irgendwer hat die Adresse des Kontos eingetippt - bestätigt hat sie dort niemand
  const planted = await prisma.participant.create({ data: { name: 'Irgendwer', email: guest.email, isVerified: false } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: planted.id, isAttending: true } })

  const page = await asGuest(browser, guest)
  await page.goto(`/${event.slug}`)
  await expect(page.getByLabel('Dein Name')).toHaveValue(guest.name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()

  expect(await prisma.participant.findUniqueOrThrow({ where: { id: planted.id } })).toMatchObject({ guestUserId: null, name: 'Irgendwer' })
  const own = await prisma.participant.findFirstOrThrow({ where: { guestUserId: guest.id } })
  expect(own.id).not.toBe(planted.id)
  expect(own).toMatchObject({ email: guest.email, isVerified: true })
})
