import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Event, GuestUser } from '@prisma/client'
import { TEST_CRON_SECRET } from '../../playwright.config'
import {
  BASE_URL, TEST_SEATING_BASE_URL, createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin,
  linkTool, locationOf, login, prisma, readForm, submitForm, unique, uniqueEmail
} from './helpers'

// Antwort „Vielleicht“ (docs/KONZEPT-VIELLEICHT.md): für verknüpfte Tools immer eine Absage, eigene Zeile in den
// Gästelisten, bestätigte Adresse und Erinnerungszeitpunkt, automatische Absage am Stichtag.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WITH_EMAIL = JSON.stringify({ askEmail: true, askPhone: false, askDiet: false, askAlcohol: false })
const fullHour = (at: number) => new Date(Math.floor(at / HOUR) * HOUR)

async function answerMaybe(page: Page, event: Event, email: string) {
  await page.goto(`/${event.slug}`)
  await page.getByLabel('Dein Name').fill('Vielleicht-Gast')
  await page.locator('input[name="isAttending"][value="maybe"]').check()
  await expect(page.getByTestId('maybe-fields')).toBeVisible()
  await page.getByLabel('E-Mail-Adresse (für die Erinnerung)').fill(email)
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith(BASE_URL))
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await response
}

test('über das Formular: als Absage gespeichert, Seating bleibt zu, eigene Zeile in den Gästelisten, Bestätigung aktiviert die Erinnerung', async ({ page, request, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: WITH_EMAIL, allowMaybe: true, isGuestListVisible: true, date: new Date(Date.now() + 10 * DAY) })
  await linkTool(event, 'seating', `${TEST_SEATING_BASE_URL}/rsvp/cmseat${unique()}`)
  const email = uniqueEmail('vielleicht')

  await answerMaybe(page, event, email)
  await expect(page.getByTestId('maybe-success')).toContainText('Notiert: vielleicht')
  await expect(page.getByTestId('maybe-note')).toContainText('Bitte bestätige vorher deine E-Mail-Adresse')

  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true } })
  expect(rsvp).toMatchObject({ isAttending: false, isMaybe: true, maybeRemindedAt: null, declineReason: null })
  // Vorbelegt ist der späteste Zeitpunkt: 24 h vor dem Stichtag (Beginn − 12 h), volle Stunde
  expect(rsvp.maybeRemindAt).toEqual(fullHour(event.date.getTime() - 36 * HOUR))
  expect(rsvp.participant).toMatchObject({ email, isVerified: false })
  expect(rsvp.participant.verifyToken).toBeTruthy()

  // Für verknüpfte Tools eine Absage: kein Sitzplatz - Positivkontrolle mit einer Zusage
  const seat = (token: string) => request.get(`/api/seating-link/${event.id}?token=${encodeURIComponent(token)}`, { maxRedirects: 0 })
  expect(locationOf(await seat(rsvp.participant.editToken))!.origin).toBe(BASE_URL)
  const confirmed = await createRsvp(event)
  expect(locationOf(await seat(confirmed.participant.editToken))!.origin).toBe(TEST_SEATING_BASE_URL)

  // Öffentliche Gästeliste: „Vielleicht“, nicht „Abgesagt“
  await page.goto(`/${event.slug}`)
  const row = page.locator('li').filter({ hasText: 'Vielleicht-Gast' })
  await expect(row).toContainText('Vielleicht')
  await expect(row).not.toContainText('Abgesagt')

  // Persönlicher Link: „Vielleicht“ ist vorbelegt, samt Erinnerung
  await page.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
  await expect(page.locator('input[name="isAttending"][value="maybe"]')).toBeChecked()
  await expect(page.locator('#maybeRemindAt')).not.toHaveValue('')

  // Verwaltung: eigener Filter, Stand der Erinnerung, Absagen zählen es nicht
  const adminContext = await browser.newContext({ baseURL: BASE_URL })
  const admin = await adminContext.newPage()
  await login(admin, owner.email)
  await admin.goto(`/admin/events/${event.id}/gaeste?filter=vielleicht`)
  await expect(admin.getByTestId('guest-row')).toHaveCount(1)
  await expect(admin.getByTestId('maybe-status')).toHaveText('Mail nicht bestätigt')
  await admin.goto(`/admin/events/${event.id}/gaeste?filter=absagen`)
  await expect(admin.getByTestId('guest-row')).toHaveCount(0)

  // Bestätigen: ab dann läuft die Erinnerung
  await page.goto(`/verify?token=${rsvp.participant.verifyToken}`)
  await page.getByRole('button', { name: 'Jetzt bestätigen' }).click()
  await expect(page.getByText('Wir erinnern dich am')).toBeVisible()
  expect(await prisma.participant.findUniqueOrThrow({ where: { id: rsvp.participantId } })).toMatchObject({ isVerified: true, verifyToken: null })
  await admin.goto(`/admin/events/${event.id}/gaeste?filter=vielleicht`)
  await expect(admin.getByTestId('maybe-status')).toHaveText(/^Erinnerung /)
  await adminContext.close()
})

test.describe('Client-API: wann „Vielleicht“ angenommen wird', () => {
  async function member(seriesId: string): Promise<{ guest: GuestUser; token: string }> {
    const guest = await createGuestUser()
    await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId } })
    return { guest, token: await createApiToken(guest) }
  }
  const answer = (request: APIRequestContext, token: string, eventId: string, body: Record<string, unknown>) =>
    request.post(`/api/v1/termine/${eventId}/antwort`, { data: body, headers: { authorization: `Bearer ${token}` } })

  test('nicht erlaubt, zu spät oder ohne Zeitpunkt abgelehnt; ein Konto braucht keine zweite Bestätigung', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const allowed = await createSeries(owner, { askEmail: true, allowMaybe: true })
    const closed = await createSeries(owner, { askEmail: true, allowMaybe: false })
    const date = new Date(Date.now() + 10 * DAY)
    const termin = await createTermin(allowed, { date })
    // Bei Reihen-Terminen zählt die Reihe, nicht Event.allowMaybe
    const closedTermin = await createTermin(closed, { date, allowMaybe: true })
    const { guest, token } = await member(allowed.id)
    const { token: closedToken } = await member(closed.id)
    const latest = fullHour(date.getTime() - 36 * HOUR)

    const refused = await answer(request, closedToken, closedTermin.id, { isAttending: false, maybe: true, maybeRemindAt: new Date(Date.now() + DAY).toISOString() })
    expect(refused.status()).toBe(400)
    expect((await refused.json()).error).toContain('nicht (mehr) möglich')
    const tooLate = await answer(request, token, termin.id, { isAttending: false, maybe: true, maybeRemindAt: new Date(latest.getTime() + HOUR).toISOString() })
    expect(tooLate.status()).toBe(400)
    expect((await tooLate.json()).error).toContain('24 Stunden vor dem Stichtag')
    expect((await answer(request, token, termin.id, { isAttending: false, maybe: true })).status()).toBe(400)
    expect(await prisma.rsvp.count({ where: { eventId: { in: [termin.id, closedTermin.id] } } })).toBe(0)

    // Positivkontrolle: genau die Grenze geht; das bestätigte Konto braucht keine Bestätigungs-Mail
    const ok = await answer(request, token, termin.id, { isAttending: false, maybe: true, maybeRemindAt: latest.toISOString() })
    expect(ok.status()).toBe(200)
    expect(await ok.json()).toMatchObject({ isAttending: false, maybe: true, maybeRemindAt: latest.toISOString(), needsVerification: false })
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: termin.id }, include: { participant: true } })
    expect(rsvp).toMatchObject({ isAttending: false, isMaybe: true, maybeRemindAt: latest })
    expect(rsvp.participant).toMatchObject({ email: guest.email, isVerified: true })

    // Zusage beendet „vielleicht“
    expect((await answer(request, token, termin.id, { isAttending: true })).status()).toBe(200)
    expect(await prisma.rsvp.findFirstOrThrow({ where: { eventId: termin.id } })).toMatchObject({ isAttending: true, isMaybe: false, maybeRemindAt: null })
  })
})

test('Cron: Erinnerung nur mit bestätigter Adresse, nach dem Stichtag wird „vielleicht“ zur Absage', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const soon = await createEvent(owner, { allowMaybe: true, formConfig: WITH_EMAIL, date: new Date(Date.now() + 5 * DAY) })
  const past = new Date(Date.now() - HOUR)
  const maybeRsvp = async (event: Event, verified: boolean) => {
    const { rsvp, participant } = await createRsvp(event, { isAttending: false })
    await prisma.participant.update({ where: { id: participant.id }, data: { email: uniqueEmail('cron'), isVerified: verified } })
    return prisma.rsvp.update({ where: { id: rsvp.id }, data: { isMaybe: true, maybeRemindAt: past } })
  }
  const verified = await maybeRsvp(soon, true)
  const unverified = await maybeRsvp(soon, false)
  // Beginn in 6 Stunden: Stichtag (Beginn − 12 h) vorbei
  const tomorrow = await createEvent(owner, { allowMaybe: true, formConfig: WITH_EMAIL, date: new Date(Date.now() + 6 * HOUR) })
  const expired = await maybeRsvp(tomorrow, true)
  // Haushalt: Anna kommt, Ben vielleicht - nur Ben wird zur Absage, die Zusage bleibt
  const household = await createRsvp(tomorrow, { isAttending: true })
  await prisma.rsvp.update({ where: { id: household.rsvp.id }, data: { maybeRemindAt: past } })
  await prisma.rsvpPerson.createMany({ data: [
    { rsvpId: household.rsvp.id, position: 0, name: 'Anna', isAttending: true },
    { rsvpId: household.rsvp.id, position: 1, name: 'Ben', isAttending: false, isMaybe: true }
  ] })

  const response = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.maybeReminders).toBeGreaterThanOrEqual(1)
  expect(result.maybeDeclined).toBeGreaterThanOrEqual(2)

  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: verified.id } })).maybeRemindedAt).not.toBeNull()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: unverified.id } })).toMatchObject({ isMaybe: true, maybeRemindedAt: null })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({ isAttending: false, isMaybe: false, maybeRemindAt: null })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: household.rsvp.id } })).toMatchObject({ isAttending: true, maybeRemindAt: null })
  expect(await prisma.rsvpPerson.count({ where: { rsvpId: household.rsvp.id, isMaybe: true } })).toBe(0)

  // Ein zweiter Lauf schickt nichts doppelt
  const remindedAt = (await prisma.rsvp.findUniqueOrThrow({ where: { id: verified.id } })).maybeRemindedAt
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: verified.id } })).maybeRemindedAt).toEqual(remindedAt)
})

test('Verwaltung: ohne E-Mail-Abfrage abgelehnt, Vorverlegen rückt Erinnerungen nach vorn, Abschalten sagt alle ab', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { allowMaybe: true, formConfig: WITH_EMAIL, date: new Date(Date.now() + 20 * DAY) })
  const { rsvp } = await createRsvp(event, { isAttending: false })
  const lateReminder = new Date(event.date.getTime() - 5 * DAY)
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { isMaybe: true, maybeRemindAt: lateReminder } })

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=formular`)
  await expect(page.getByTestId('maybe-disable-warning')).toContainText('1 Antwort steht auf „vielleicht“')
  // Im Browser gesperrt ohne E-Mail-Abfrage
  await page.getByRole('checkbox', { name: 'E-Mail-Adresse', exact: true }).uncheck()
  await expect(page.getByTestId('rule-allowMaybe')).toContainText('E-Mail-Abfrage')

  // Server: dieselbe Regel, auch wenn das Formular umgangen wird - Positivkontrolle mit E-Mail-Abfrage
  const form = await readForm(page, '#event-settings-form')
  const without = Object.fromEntries(form.fields.filter(([name]) => name !== 'askEmail'))
  const refused = await submitForm(page, { url: form.url, fields: Object.entries(without) }, { allowMaybe: 'on' })
  expect(await refused.text()).toContain('„Vielleicht“ braucht die E-Mail-Abfrage')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).allowMaybe).toBe(true)

  // Termin auf in 3 Tagen vorverlegt: Die Erinnerung rückt auf 24 h vor den Stichtag
  const newDate = new Date(Date.now() + 3 * DAY)
  const local = new Date(newDate.getTime() - newDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  const moved = await submitForm(page, form, { allowMaybe: 'on', askEmail: 'on', date: local })
  expect(moved.status()).toBeLessThan(400)
  const savedDate = (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).date
  await expect.poll(async () => (await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).maybeRemindAt?.getTime())
    .toBe(fullHour(savedDate.getTime() - 36 * HOUR).getTime())

  // Abschalten: alle „vielleicht“ werden abgesagt
  const off = await submitForm(page, await readForm(page, '#event-settings-form'), { allowMaybe: '' })
  expect(off.status()).toBeLessThan(400)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).allowMaybe).toBe(false)
  await expect.poll(async () => (await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).isMaybe).toBe(false)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).toMatchObject({ isAttending: false, maybeRemindAt: null })
})

test('Verwaltung kann „vielleicht“ nicht setzen, nur behalten oder ersetzen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { allowMaybe: true, formConfig: WITH_EMAIL })
  const plain = await createRsvp(event, { isAttending: false })
  const maybe = await createRsvp(event, { isAttending: false })
  const remindAt = fullHour(Date.now() + 2 * DAY)
  await prisma.rsvp.update({ where: { id: maybe.rsvp.id }, data: { isMaybe: true, maybeRemindAt: remindAt } })
  await login(page, owner.email)

  // Eine Absage wird mit „maybe“ nicht zu „vielleicht“
  await page.goto(`/admin/edit-rsvp/${plain.rsvp.id}`)
  const plainForm = await readForm(page, 'form:has(#isAttending)')
  await submitForm(page, plainForm, { isAttending: 'maybe' })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: plain.rsvp.id } })).toMatchObject({ isAttending: false, isMaybe: false, maybeRemindAt: null })

  // Bestehendes „vielleicht“ bleibt beim Speichern, eine Zusage ersetzt es
  await page.goto(`/admin/edit-rsvp/${maybe.rsvp.id}`)
  await expect(page.locator('#isAttending')).toHaveValue('maybe')
  const maybeForm = await readForm(page, 'form:has(#isAttending)')
  await submitForm(page, maybeForm)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: maybe.rsvp.id } })).toMatchObject({ isMaybe: true, maybeRemindAt: remindAt })
  await submitForm(page, maybeForm, { isAttending: 'true' })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: maybe.rsvp.id } })).toMatchObject({ isAttending: true, isMaybe: false, maybeRemindAt: null })
})

test('Einladungsmodus: „vielleicht“ pro Person - der Haushalt kommt, eine Person überlegt noch', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: WITH_EMAIL, inviteOnly: true, allowMaybe: true, date: new Date(Date.now() + 10 * DAY) })
  const invitation = await prisma.invitation.create({
    data: {
      event: { connect: { id: event.id } }, label: 'Familie Vielleicht', email: null, extraPersons: 0,
      participant: { create: { name: 'Familie Vielleicht', editToken: randomUUID() } },
      persons: { create: [{ name: 'Anna', ageGroup: 'ADULT', position: 0 }, { name: 'Ben', ageGroup: 'ADULT', position: 1 }] }
    },
    include: { participant: true }
  })
  const choose = (name: string, value: string) => page.getByRole('radiogroup', { name: `Kommt ${name}?` }).getByLabel(value, { exact: true }).check()

  await page.goto(`/${event.slug}?token=${invitation.participant.editToken}`)
  await choose('Anna', 'kommt')
  await choose('Ben', 'vielleicht')
  await expect(page.getByTestId('maybe-fields')).toBeVisible()
  // Die Adresse steht im Teil für die Zusage (einmal im Formular)
  await expect(page.locator('input[name="email"]')).toHaveCount(1)
  await page.locator('input[name="email"]').fill(uniqueEmail('haushalt'))
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()
  await expect(page.getByTestId('maybe-note')).toContainText('Bitte bestätige vorher deine E-Mail-Adresse')

  const saved = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { persons: { orderBy: { position: 'asc' } }, participant: true } })
  expect(saved).toMatchObject({ isAttending: true, isMaybe: false, participant: { isVerified: false } })
  expect(saved.maybeRemindAt).not.toBeNull()
  expect(saved.persons.map(p => [p.name, p.isAttending, p.isMaybe])).toEqual([['Anna', true, false], ['Ben', false, true]])

  // Niemand kommt fest, Ben überlegt: die ganze Antwort steht auf vielleicht
  await page.goto(`/${event.slug}?token=${invitation.participant.editToken}`)
  await choose('Anna', 'kommt nicht')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByTestId('maybe-success')).toBeVisible()
  expect(await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id } })).toMatchObject({ isAttending: false, isMaybe: true })
})
