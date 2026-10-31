import { expect, test } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { BASE_URL, cookieHeader, createAccount, createEvent, createRsvp, login, prisma, uniqueEmail } from './helpers'

// Rückbestätigung vor dem Termin (Idee L30, app/lib/reconfirm.ts): Der Cron fragt feste Zusagen „Kommst du noch?“,
// Gäste bestätigen oder sagen per Knopf ab (nur POST), an der Frist wird auf Wunsch automatisch abgesagt.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function withEmail(participantId: string) {
  return prisma.participant.update({ where: { id: participantId }, data: { email: uniqueEmail('rueck') } })
}

test('Cron fragt feste Zusagen einmal, Gäste bestätigen bzw. sagen ab, die Warteliste rückt nach', async ({ page, request, browser }) => {
  const owner = await createAccount('CREATOR')
  // Beginn in zwei Tagen, Nachfrage drei Tage vorher: der Zeitraum läuft schon
  const event = await createEvent(owner, { date: new Date(Date.now() + 2 * DAY), maxCapacity: 2, reconfirmDays: 3 })
  const anna = await createRsvp(event, { name: 'Anna' })
  const ben = await createRsvp(event, { name: 'Ben' })
  const wartend = await createRsvp(event, { name: 'Wartend', isOnWaitlist: true })
  const ohneKontakt = await createEvent(owner, { date: new Date(Date.now() + 2 * DAY), reconfirmDays: 3 })
  const stumm = await createRsvp(ohneKontakt, { name: 'Ohne Mail' })
  await Promise.all([withEmail(anna.participant.id), withEmail(ben.participant.id), withEmail(wartend.participant.id), withEmail(stumm.participant.id)])
  await prisma.participant.update({ where: { id: stumm.participant.id }, data: { email: null } })

  const cron = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(cron.ok()).toBe(true)
  const asked = await prisma.rsvp.findMany({ where: { eventId: { in: [event.id, ohneKontakt.id] } } })
  const byId = new Map(asked.map(r => [r.id, r]))
  expect(byId.get(anna.rsvp.id)!.reconfirmAskedAt).not.toBeNull()
  expect(byId.get(ben.rsvp.id)!.reconfirmAskedAt).not.toBeNull()
  // Warteliste wird nicht gefragt, ohne Mail und Push erreicht die Frage niemanden
  expect(byId.get(wartend.rsvp.id)!.reconfirmAskedAt).toBeNull()
  expect(byId.get(stumm.rsvp.id)!.reconfirmAskedAt).toBeNull()
  // Ein zweiter Lauf fragt nicht noch einmal
  const firstAsked = byId.get(anna.rsvp.id)!.reconfirmAskedAt
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: anna.rsvp.id } })).reconfirmAskedAt).toEqual(firstAsked)

  // Der Link aus der Mail öffnet nur die Seite - bestätigt wird erst per Knopf
  await page.goto(`/${event.slug}?token=${anna.participant.editToken}`)
  await expect(page.getByTestId('reconfirm-box')).toContainText('Kommst du noch?')
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: anna.rsvp.id } })).reconfirmedAt).toBeNull()
  await page.getByRole('button', { name: 'Ja, ich komme' }).click()
  await expect(page.getByTestId('reconfirm-result')).toContainText('Dein Platz ist bestätigt')
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: anna.rsvp.id } })).reconfirmedAt).not.toBeNull()
  await page.reload()
  await expect(page.getByTestId('reconfirm-box')).toHaveCount(0)

  // Ben sagt ab: Platz frei, die Warteliste rückt nach (und wird beim nächsten Lauf selbst gefragt)
  await page.goto(`/${event.slug}?token=${ben.participant.editToken}`)
  await page.getByRole('button', { name: 'Nein, ich kann nicht' }).click()
  await expect(page.getByTestId('reconfirm-result')).toContainText('du bist jetzt abgesagt')
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: ben.rsvp.id } })).toMatchObject({ isAttending: false, declineReason: null, reconfirmLapsedAt: null })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: wartend.rsvp.id } })).toMatchObject({ isAttending: true, isOnWaitlist: false })
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: wartend.rsvp.id } })).reconfirmAskedAt).not.toBeNull()

  // Verwaltung: Stand je Zusage und Filter „Unbestätigt“
  const adminContext = await browser.newContext({ baseURL: BASE_URL })
  const admin = await adminContext.newPage()
  await login(admin, owner.email)
  await admin.goto(`/admin/events/${event.id}/gaeste`)
  await expect(admin.getByTestId('guest-row').filter({ hasText: 'Anna' }).getByTestId('reconfirm-status')).toHaveText('bestätigt')
  await expect(admin.getByTestId('guest-row').filter({ hasText: 'Wartend' }).getByTestId('reconfirm-status')).toHaveText('Rückbestätigung offen')
  await admin.goto(`/admin/events/${event.id}/gaeste?filter=unbestaetigt`)
  await expect(admin.getByTestId('guest-row')).toHaveCount(1)
  await admin.goto(`/admin/events/${ohneKontakt.id}/gaeste`)
  await expect(admin.getByTestId('reconfirm-status')).toHaveText('Rückbestätigung offen · nicht gefragt')
  const csv = await (await admin.request.get(`/api/export?eventId=${event.id}`, { headers: await cookieHeader(adminContext) })).text()
  expect(csv).toContain('Rückbestätigung')
  expect(csv).toMatch(/Anna;.*;bestätigt/)
  await adminContext.close()
})

test('Knopf nur mit dem eigenen Link zu genau diesem Termin', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { date: new Date(Date.now() + 2 * DAY), reconfirmDays: 3 })
  const other = await createEvent(owner, { date: new Date(Date.now() + 2 * DAY), reconfirmDays: 3 })
  const own = await createRsvp(event, { name: 'Eigene' })
  const foreign = await createRsvp(other, { name: 'Fremde' })

  // Angriff: im Formular den Link einer Zusage eines ANDEREN Termins einsetzen - nichts passiert
  await page.goto(`/${event.slug}?token=${own.participant.editToken}`)
  await page.locator('[data-testid="reconfirm-box"] input[name="editToken"]').evaluate((el, token) => { (el as HTMLInputElement).value = token }, foreign.participant.editToken)
  await page.getByRole('button', { name: 'Nein, ich kann nicht' }).click()
  await expect(page.getByTestId('reconfirm-box')).toContainText('Das hat nicht geklappt')
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: foreign.rsvp.id } })).toMatchObject({ isAttending: true })
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: own.rsvp.id } })).toMatchObject({ isAttending: true })

  // Positivkontrolle: mit dem eigenen Link klappt dieselbe Absage
  await page.goto(`/${event.slug}?token=${own.participant.editToken}`)
  await page.getByRole('button', { name: 'Nein, ich kann nicht' }).click()
  await expect(page.getByTestId('reconfirm-result')).toBeVisible()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: own.rsvp.id } })).toMatchObject({ isAttending: false })

  // Vor dem Zeitraum gibt es keine Frage
  const later = await createEvent(owner, { reconfirmDays: 3 })
  const early = await createRsvp(later)
  await page.goto(`/${later.slug}?token=${early.participant.editToken}`)
  await expect(page.getByTestId('reconfirm-box')).toHaveCount(0)
})

test('an der Frist: automatische Absage nur für Gefragte mit genug Zeit und ohne Ticketpreis', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  // Beginn in 20 Stunden: die Frist (24 h vorher) ist vorbei
  const event = await createEvent(owner, { date: new Date(Date.now() + 20 * HOUR), maxCapacity: 4, reconfirmDays: 3, reconfirmAutoDecline: true })
  const longAgo = new Date(Date.now() - 2 * DAY)
  const schweigt = await createRsvp(event, { name: 'Schweigt' })
  const bestaetigt = await createRsvp(event, { name: 'Bestätigt' })
  const bezahlt = await createRsvp(event, { name: 'Bezahlt' })
  const spaet = await createRsvp(event, { name: 'Spät gefragt' })
  const wartend = await createRsvp(event, { name: 'Wartend', isOnWaitlist: true })
  await prisma.rsvp.update({ where: { id: schweigt.rsvp.id }, data: { reconfirmAskedAt: longAgo } })
  await prisma.rsvp.update({ where: { id: bestaetigt.rsvp.id }, data: { reconfirmAskedAt: longAgo, reconfirmedAt: new Date() } })
  await prisma.rsvp.update({ where: { id: bezahlt.rsvp.id }, data: { reconfirmAskedAt: longAgo, amountCents: 1500 } })
  // gefragt erst 10 Stunden vor der Frist (z. B. nachgerückt) - zu wenig Zeit
  await prisma.rsvp.update({ where: { id: spaet.rsvp.id }, data: { reconfirmAskedAt: new Date(Date.now() - 14 * HOUR) } })

  const cron = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(cron.ok()).toBe(true)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: schweigt.rsvp.id } })).toMatchObject({ isAttending: false, declineReason: null })
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: schweigt.rsvp.id } })).reconfirmLapsedAt).not.toBeNull()
  for (const kept of [bestaetigt, bezahlt, spaet]) {
    expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: kept.rsvp.id } })).toMatchObject({ isAttending: true, isOnWaitlist: false, reconfirmLapsedAt: null })
  }
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: wartend.rsvp.id } })).toMatchObject({ isAttending: true, isOnWaitlist: false })

  // Positivkontrolle für den Schalter: ohne automatische Absage bleibt es bei der Markierung
  const markOnly = await createEvent(owner, { date: new Date(Date.now() + 20 * HOUR), reconfirmDays: 3 })
  const markiert = await createRsvp(markOnly)
  await prisma.rsvp.update({ where: { id: markiert.rsvp.id }, data: { reconfirmAskedAt: longAgo } })
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: markiert.rsvp.id } })).toMatchObject({ isAttending: true, reconfirmLapsedAt: null })
})

test('Einstellungen: speichern, nicht im Einladungsmodus', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=ablauf`)
  await page.getByLabel('Rückbestätigung: „Kommst du noch?“').check()
  await page.getByLabel('Tage vor dem Event fragen').fill('4')
  await page.getByLabel('Ohne Bestätigung bis zur Frist automatisch absagen').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).first().click()
  await expect(page).toHaveURL(/gespeichert=1/)
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ reconfirmDays: 4, reconfirmAutoDecline: true })

  // Einladungsmodus: im Browser gesperrt, der Server lehnt es ebenso ab
  const invite = await createEvent(owner, { inviteOnly: true })
  await page.goto(`/admin/events/${invite.id}/einstellungen?abschnitt=ablauf`)
  await expect(page.getByLabel('Rückbestätigung: „Kommst du noch?“')).toBeDisabled()
  await page.getByLabel('Rückbestätigung: „Kommst du noch?“').evaluate(el => { (el as HTMLInputElement).disabled = false; (el as HTMLInputElement).checked = true })
  await page.getByRole('button', { name: 'Änderungen speichern' }).first().click()
  await expect(page.getByText('Die Rückbestätigung gibt es nicht im Einladungsmodus')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: invite.id } })).reconfirmDays).toBeNull()
})
