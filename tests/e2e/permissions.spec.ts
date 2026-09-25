import { expect, test, type Browser, type Page } from '@playwright/test'
import type { User } from '@prisma/client'
import {
  BASE_URL, cookieHeader, createAccount, createEvent, createRsvp, createSeries, createTermin, locationOf, login, prisma,
  readForm, submitForm, uniqueEmail
} from './helpers'

// Rechte (app/lib/permissions.ts) werden in JEDER Server Action und Route geprüft, nicht nur auf
// der Seite. Stufen: Owner bzw. Admin (alles), Moderator*in per ResourceAccess - direkt auf ein
// Event oder auf eine ganze Reihe und damit auf jeden ihrer Termine - (Gästeliste, Check-in,
// Export), fremdes Konto (nichts). Jeder Angriffsfall hat eine Positivkontrolle: Derselbe Aufruf
// wirkt, wenn ihn ein berechtigtes Konto schickt - sonst würde ein kaputtes Formular einen Schutz
// nur vortäuschen.

async function scenario(browser: Browser) {
  const owner = await createAccount('CREATOR')
  const admin = await createAccount('ADMIN')
  const stranger = await createAccount('CREATOR')
  const eventMod = await createAccount('MODERATOR')
  const seriesMod = await createAccount('MODERATOR')

  const event = await createEvent(owner, { enableCheckin: true })
  const series = await createSeries(owner)
  const termin = await createTermin(series, { enableCheckin: true })
  await prisma.resourceAccess.create({ data: { userId: eventMod.id, eventId: event.id } })
  await prisma.resourceAccess.create({ data: { userId: seriesMod.id, seriesId: series.id } })
  const onEvent = await createRsvp(event, { name: 'Erna Event' })
  const onTermin = await createRsvp(termin, { name: 'Theo Termin' })

  async function pageFor(user: User | null): Promise<Page> {
    const page = await browser.newPage()
    if (user) {
      await login(page, user.email)
      await expect(page).toHaveURL(`${BASE_URL}/admin`)
    }
    return page
  }

  return { owner, admin, stranger, eventMod, seriesMod, event, series, termin, onEvent, onTermin, pageFor }
}

test('CSV-Export: Owner, Admin und passende Moderator*innen ja - fremd, falsches Event und ohne Sitzung nein', async ({ browser }) => {
  const s = await scenario(browser)
  const cases: [User | null, string, number][] = [
    [null, s.event.id, 401],
    [s.stranger, s.event.id, 404],
    [s.stranger, s.termin.id, 404],
    [s.eventMod, s.termin.id, 404], // Zugriff auf ein anderes Event
    [s.seriesMod, s.event.id, 404], // Zugriff auf eine Reihe, zu der das Event nicht gehört
    [s.owner, s.event.id, 200],
    [s.owner, s.termin.id, 200],
    [s.admin, s.termin.id, 200],
    [s.eventMod, s.event.id, 200],
    [s.seriesMod, s.termin.id, 200] // über die Reihe freigegeben
  ]
  for (const [user, eventId, status] of cases) {
    const page = await s.pageFor(user)
    const response = await page.request.get(`/api/export?eventId=${eventId}`, { headers: await cookieHeader(page.context()) })
    const label = `${user?.email ?? 'ohne Sitzung'} -> ${eventId === s.event.id ? 'Event' : 'Termin'}`
    expect(response.status(), label).toBe(status)
    const body = await response.text()
    if (status === 200) expect(body, label).toContain(eventId === s.event.id ? 'Erna Event' : 'Theo Termin')
    else expect(body, label).not.toMatch(/Erna Event|Theo Termin/)
    await page.close()
  }
})

test('QR-Check-in-Seite: fremde Konten checken nicht ein, Moderator*in der Reihe schon', async ({ browser }) => {
  const s = await scenario(browser)
  const attended = async () => (await prisma.rsvp.findUniqueOrThrow({ where: { id: s.onTermin.rsvp.id } })).hasAttended

  for (const user of [s.stranger, s.eventMod]) {
    const page = await s.pageFor(user)
    await page.goto(`/admin/checkin/${s.onTermin.rsvp.id}`)
    await expect(page.getByRole('heading', { name: 'Nicht dein Event' }), user.email).toBeVisible()
    await page.close()
  }
  const anonymous = await s.pageFor(null)
  await anonymous.goto(`/admin/checkin/${s.onTermin.rsvp.id}`)
  await expect(anonymous).toHaveURL(`${BASE_URL}/admin/login`)
  expect(await attended()).toBe(false)

  // Positivkontrolle
  const moderator = await s.pageFor(s.seriesMod)
  await moderator.goto(`/admin/checkin/${s.onTermin.rsvp.id}`)
  await expect(moderator.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  expect(await attended()).toBe(true)
})

test('Einchecken per Server Action (toggleAttendance): nur mit Moderator-Rechten auf genau dieses Event', async ({ browser }) => {
  const s = await scenario(browser)
  const ownerPage = await s.pageFor(s.owner)
  const toggle = await readForm(ownerPage, 'form:has(input[name="rsvpId"]):has(button:has-text("Nicht da"))')
  const attended = async (id: string) => (await prisma.rsvp.findUniqueOrThrow({ where: { id } })).hasAttended

  await submitForm(await s.pageFor(null), toggle, { rsvpId: s.onEvent.rsvp.id })
  await submitForm(await s.pageFor(s.stranger), toggle, { rsvpId: s.onEvent.rsvp.id })
  const eventModPage = await s.pageFor(s.eventMod)
  await submitForm(eventModPage, toggle, { rsvpId: s.onTermin.rsvp.id })
  expect(await attended(s.onEvent.rsvp.id)).toBe(false)
  expect(await attended(s.onTermin.rsvp.id)).toBe(false)

  // Positivkontrollen: direkt freigegeben bzw. über die Reihe freigegeben.
  await submitForm(eventModPage, toggle, { rsvpId: s.onEvent.rsvp.id })
  expect(await attended(s.onEvent.rsvp.id)).toBe(true)
  await submitForm(await s.pageFor(s.seriesMod), toggle, { rsvpId: s.onTermin.rsvp.id })
  expect(await attended(s.onTermin.rsvp.id)).toBe(true)
})

test('Event löschen und weiter freigeben: nur Owner/Admin, nicht Moderator*innen', async ({ browser }) => {
  const s = await scenario(browser)
  const victim = await createEvent(s.owner)
  await prisma.resourceAccess.create({ data: { userId: s.eventMod.id, eventId: victim.id } })
  const ownerPage = await s.pageFor(s.owner)
  const deleteForm = await readForm(ownerPage, 'form:has(input[name="eventId"]):has(button:has-text("Löschen"))')

  await ownerPage.goto(`/admin/edit/${victim.id}`)
  const shareForm = await readForm(ownerPage, 'form:has(input[name="eventId"]):has(input[name="email"])')

  const eventModPage = await s.pageFor(s.eventMod)
  const strangerPage = await s.pageFor(s.stranger)
  for (const page of [eventModPage, strangerPage]) {
    await submitForm(page, deleteForm, { eventId: victim.id })
    // Eine Moderator*in darf ihren Zugriff nicht an Dritte weitergeben.
    await submitForm(page, shareForm, { eventId: victim.id, email: s.stranger.email })
  }
  expect(await prisma.event.findUnique({ where: { id: victim.id } })).not.toBeNull()
  expect(await prisma.resourceAccess.count({ where: { userId: s.stranger.id } })).toBe(0)

  // Positivkontrollen
  const shared = await submitForm(ownerPage, shareForm, { eventId: victim.id, email: s.stranger.email })
  expect(locationOf(shared)?.pathname).toBe(`/admin/edit/${victim.id}`)
  expect(await prisma.resourceAccess.count({ where: { userId: s.stranger.id, eventId: victim.id } })).toBe(1)
  await submitForm(ownerPage, deleteForm, { eventId: victim.id })
  expect(await prisma.event.findUnique({ where: { id: victim.id } })).toBeNull()
  expect(await prisma.resourceAccess.count({ where: { eventId: victim.id } })).toBe(0)
})

test('Konto anlegen: ohne Sitzung und als Moderator*in wirkungslos, Creator nur Moderator*innen, Admin frei', async ({ browser }) => {
  const admin = await createAccount('ADMIN')
  const creator = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const adminPage = await browser.newPage()
  await login(adminPage, admin.email)
  await adminPage.goto('/admin/create-user')
  const create = await readForm(adminPage, 'form:has(input[name="password"])')
  const roleOf = async (email: string) => (await prisma.user.findUnique({ where: { email } }))?.role ?? null
  const password = 'ein sicheres Passwort für neue Konten'

  const anonymousEmail = uniqueEmail('anonym')
  await submitForm(await browser.newPage(), create, { email: anonymousEmail, password, role: 'ADMIN' })
  expect(await roleOf(anonymousEmail)).toBeNull()

  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  const modEmail = uniqueEmail('mod')
  await submitForm(modPage, create, { email: modEmail, password, role: 'CREATOR' })
  expect(await roleOf(modEmail)).toBeNull()

  const creatorPage = await browser.newPage()
  await login(creatorPage, creator.email)
  const escalation = uniqueEmail('eskalation')
  await submitForm(creatorPage, create, { email: escalation, password, role: 'ADMIN' })
  expect(await roleOf(escalation)).toBe('MODERATOR')

  // Serverseitige Passwort-Regel auch beim Anlegen.
  const weak = uniqueEmail('schwach')
  expect(locationOf(await submitForm(adminPage, create, { email: weak, password: 'kurz', role: 'CREATOR' }))?.search).toBe('?error=weak')
  expect(await roleOf(weak)).toBeNull()

  // Positivkontrolle
  const allowed = uniqueEmail('neu')
  expect(locationOf(await submitForm(adminPage, create, { email: allowed, password, role: 'CREATOR' }))?.pathname).toBe('/admin')
  expect(await roleOf(allowed)).toBe('CREATOR')
})

test('Rollen ändern und Konten löschen: nur Admins, und nie ein Admin-Konto', async ({ browser }) => {
  const admin = await createAccount('ADMIN')
  const otherAdmin = await createAccount('ADMIN')
  const target = await createAccount('CREATOR')
  const creator = await createAccount('CREATOR')
  const adminPage = await browser.newPage()
  await login(adminPage, admin.email)
  await adminPage.goto('/admin/users')
  const roleForm = await readForm(adminPage, 'form:has(select[name="role"])')
  const deleteForm = await readForm(adminPage, 'form:has(input[name="userId"]):has(button:has-text("Löschen"))')
  const roleOf = async (id: string) => (await prisma.user.findUnique({ where: { id } }))?.role ?? null

  const creatorPage = await browser.newPage()
  await login(creatorPage, creator.email)
  await creatorPage.goto('/admin/users')
  await expect(creatorPage).toHaveURL(`${BASE_URL}/admin`)
  await submitForm(creatorPage, roleForm, { userId: target.id, role: 'ADMIN' })
  await submitForm(creatorPage, deleteForm, { userId: target.id })
  expect(await roleOf(target.id)).toBe('CREATOR')

  for (const id of [otherAdmin.id, admin.id]) {
    await submitForm(adminPage, roleForm, { userId: id, role: 'MODERATOR' })
    await submitForm(adminPage, deleteForm, { userId: id })
    expect(await roleOf(id)).toBe('ADMIN')
  }

  // Positivkontrollen
  await submitForm(adminPage, roleForm, { userId: target.id, role: 'MODERATOR' })
  expect(await roleOf(target.id)).toBe('MODERATOR')
  await submitForm(adminPage, deleteForm, { userId: target.id })
  expect(await roleOf(target.id)).toBeNull()
})

test('CSRF: Server Action mit fremdem Origin wird abgelehnt', async ({ page }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  await page.goto('/admin/create-user')
  const create = await readForm(page, 'form:has(input[name="password"])')
  const password = 'ein sicheres Passwort für neue Konten'

  const email = uniqueEmail('csrf')
  const response = await submitForm(page, create, { email, password, role: 'CREATOR' }, { origin: 'https://evil.example' })
  expect(response.status()).not.toBe(303)
  expect(await prisma.user.findUnique({ where: { email } })).toBeNull()

  // Positivkontrolle mit eigenem Origin
  await submitForm(page, create, { email, password, role: 'CREATOR' })
  expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull()
})
