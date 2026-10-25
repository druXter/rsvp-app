import { expect, test, type Browser } from '@playwright/test'
import {
  createAccount, createEvent, createGuestUser, createRsvp, createSeries, createTermin, login, plantGuestSession, prisma,
  readForm, submitForm
} from './helpers'

// Teilnehmendenkonten zu einem Termin einladen (app/lib/guest-invites.ts): Auswahl nur aus Events/Reihen mit eigenem
// Zugriff (serverseitig geprüft), Termin in "Mein Konto", ohne PIN, Antwort mit dem Konto, ausblenden, zurücknehmen.

const DAY = 24 * 60 * 60 * 1000

async function guestWithAnswer(event: { id: string; seriesId: string | null }) {
  const guest = await createGuestUser()
  await createRsvp(event as never, { guestUserId: guest.id, name: guest.name })
  return guest
}

async function guestPage(browser: Browser, guest: Awaited<ReturnType<typeof createGuestUser>>) {
  const context = await browser.newContext()
  await plantGuestSession(context, guest)
  return context.newPage()
}

test('beim Anlegen: nur Konten aus eigenen Events, eingeladen ohne PIN, in Mein Konto, Antwort mit dem Konto', async ({ page, browser }) => {
  const creator = await createAccount('CREATOR')
  const other = await createAccount('CREATOR')
  const own = await createEvent(creator, { title: 'Event A' })
  const foreign = await createEvent(other, { title: 'Event B' })
  const fromOwn = await guestWithAnswer(own)
  const fromForeign = await guestWithAnswer(foreign)
  const series = await createSeries(creator, { title: 'Stammtisch' })
  const member = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: member.id, seriesId: series.id } })
  const unverified = await createGuestUser({ verified: false })
  await createRsvp(own, { guestUserId: unverified.id })

  await login(page, creator.email)
  await page.goto('/admin/create')
  await page.getByText('Teilnehmendenkonten einladen (optional)').click()
  const list = page.getByTestId('invite-candidates')
  await expect(list.getByText(fromOwn.email)).toBeVisible()
  await expect(list.getByText('aus Event A')).toBeVisible()
  await expect(list.getByText(member.email)).toBeVisible()
  await expect(list.getByText('aus Reihe Stammtisch')).toBeVisible()
  await expect(list.getByText(fromForeign.email)).toHaveCount(0)
  await expect(list.getByText(unverified.email)).toHaveCount(0)
  // Suche
  await page.getByLabel('Konten durchsuchen').fill('stammtisch')
  await expect(list.getByText(fromOwn.email)).toHaveCount(0)
  await page.getByLabel('Konten durchsuchen').fill('')

  await page.getByLabel('Titel').fill('Event C')
  await page.getByLabel('Datum und Uhrzeit').fill(new Date(Date.now() + 7 * DAY).toISOString().slice(0, 16))
  await page.getByLabel(`${fromOwn.name} (${fromOwn.email})`).check()
  await page.getByRole('button', { name: /Event anlegen|Anlegen/ }).click()
  await page.waitForURL(/\/admin\/events\/[a-z0-9]+\//)
  const eventC = await prisma.event.findFirstOrThrow({ where: { title: 'Event C', ownerId: creator.id } })
  expect(await prisma.guestUserEvent.findMany({ where: { eventId: eventC.id } })).toEqual([expect.objectContaining({ guestUserId: fromOwn.id, invitedById: creator.id, hiddenAt: null })])
  await prisma.event.update({ where: { id: eventC.id }, data: { eventPin: '4711', formConfig: JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: false }) } })

  // Eingeladen: Mein Konto zeigt den Termin, die Seite fragt nicht nach der PIN, die Antwort hängt am Konto
  const guest = await guestPage(browser, fromOwn)
  await guest.goto('/mein-konto')
  const others = guest.getByTestId('other-events')
  await expect(others.locator('a', { hasText: 'Event C' })).toContainText('Jetzt antworten')
  await others.getByText('Event C').click()
  await expect(guest.getByLabel('Dein Name')).toHaveValue(fromOwn.name)
  await guest.locator('input[name="isAttending"][value="true"]').check()
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: eventC.id }, include: { participant: true } })
  expect(rsvp.participant.guestUserId).toBe(fromOwn.id)
  await guest.goto('/mein-konto')
  await expect(others.locator('a', { hasText: 'Event C' })).toContainText('Zugesagt')
  // Event A (dort mit dem Konto geantwortet) steht ebenfalls dort
  await expect(others.locator('a', { hasText: 'Event A' })).toContainText('Zugesagt')

  // Nicht eingeladen (anderes Konto, ohne Konto): PIN nötig
  const stranger = await guestPage(browser, fromForeign)
  await stranger.goto(`/${eventC.slug}`)
  await expect(stranger.getByLabel('Dein Name')).toHaveCount(0)
  await stranger.goto('/mein-konto')
  await expect(stranger.getByText('Event C')).toHaveCount(0)

  // Ausblenden: weg aus Mein Konto, der Zugang bleibt
  await guest.goto('/mein-konto')
  await guest.getByRole('button', { name: 'Event C ausblenden' }).click()
  await expect(guest.getByText('Event C')).toHaveCount(0)
  await guest.goto(`/${eventC.slug}`)
  await expect(guest.getByLabel('Dein Name')).toBeVisible()
})

test('Reiter Gäste: Moderator*in lädt ein, fremde Kennung wird übergangen, zurücknehmen', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const target = await createEvent(owner, { title: 'Zielevent', date: new Date(Date.now() + 3 * DAY) })
  const moderated = await createEvent(owner, { title: 'Moderiertes Event' })
  const hidden = await createEvent(owner, { title: 'Nicht geteilt' })
  await prisma.resourceAccess.createMany({ data: [{ userId: moderator.id, eventId: target.id }, { userId: moderator.id, eventId: moderated.id }] })
  const visible = await guestWithAnswer(moderated)
  const secret = await guestWithAnswer(hidden)

  await login(page, moderator.email)
  await page.goto(`/admin/events/${target.id}/gaeste`)
  const list = page.getByTestId('invite-candidates')
  await expect(list.getByText(visible.email)).toBeVisible()
  await expect(list.getByText(secret.email)).toHaveCount(0)

  // Nachgespielt mit der Kennung eines Kontos außerhalb der eigenen Auswahl: übergangen
  const form = await readForm(page, 'form:has([data-testid="invite-candidates"])')
  await submitForm(page, form, { inviteGuestUser: secret.id })
  expect(await prisma.guestUserEvent.count({ where: { eventId: target.id } })).toBe(0)

  // Positivkontrolle über die Oberfläche
  await page.getByLabel(`${visible.name} (${visible.email})`).check()
  await page.getByLabel('per Mail benachrichtigen').uncheck()
  await page.getByRole('button', { name: 'Einladen' }).click()
  await expect(page.getByText('1 Konto eingeladen.')).toBeVisible()
  await expect(page.getByTestId('invited-accounts')).toContainText(visible.email)
  // Schon eingeladen: nicht mehr in der Auswahl
  await expect(page.getByTestId('invite-candidates').getByText(visible.email)).toHaveCount(0)

  const guest = await guestPage(browser, visible)
  await guest.goto('/mein-konto')
  await expect(guest.getByTestId('other-events')).toContainText('Zielevent')

  await page.getByRole('button', { name: `Einladung von ${visible.name} zurücknehmen` }).click()
  await expect(page.getByTestId('invited-accounts')).toHaveCount(0)
  await guest.goto('/mein-konto')
  await expect(guest.getByText('Zielevent')).toHaveCount(0)

  // Ohne Zugriff auf das Zielevent: nichts
  const outsider = await createAccount('CREATOR')
  const outsiderPage = await browser.newPage()
  await login(outsiderPage, outsider.email)
  await submitForm(outsiderPage, form, { inviteGuestUser: visible.id })
  expect(await prisma.guestUserEvent.count({ where: { eventId: target.id } })).toBe(0)
})

test('Termin einer Reihe ohne Mitgliedschaft und Einzel-Events mit eigener Antwort erscheinen; Einladungsmodus ohne Auswahl', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner, { title: 'Kinoabend', eventPin: '1234' })
  const termin = await createTermin(series, { title: 'Kino im Dezember', date: new Date(Date.now() + 5 * DAY) })
  const source = await createEvent(owner, { title: 'Quelle' })
  const guest = await guestWithAnswer(source)
  await prisma.guestUserEvent.create({ data: { guestUserId: guest.id, eventId: termin.id, invitedById: owner.id } })
  const answered = await createEvent(owner, { title: 'Schon beantwortet', date: new Date(Date.now() + 2 * DAY), requireGuestUser: true })
  await createRsvp(answered, { guestUserId: guest.id })

  const gp = await guestPage(browser, guest)
  await gp.goto('/mein-konto')
  const others = gp.getByTestId('other-events')
  await expect(others).toContainText('Kino im Dezember')
  await expect(others).toContainText('Kinoabend')
  await expect(others).toContainText('Schon beantwortet')
  // Reihen-PIN gilt für den eingeladenen Termin nicht
  await others.getByText('Kino im Dezember').click()
  await expect(gp.getByLabel('Dein Name')).toBeVisible()

  const invite = await createEvent(owner, { inviteOnly: true })
  await login(page, owner.email)
  await page.goto(`/admin/events/${invite.id}/gaeste`)
  await expect(page.getByText('Eingeladene Teilnehmendenkonten')).toHaveCount(0)
})
