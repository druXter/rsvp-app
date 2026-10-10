import { expect, test, type Browser } from '@playwright/test'
import {
  cookieHeader, createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin, login, prisma, readForm, submitForm
} from './helpers'

// Menüwahl pro Person (docs/KONZEPT-EINLADUNGEN.md, app/lib/menu.ts, app/lib/kitchen.ts): Gänge im
// Termin-Formular, Wahl pro Person im Gästeformular (Kleinkinder ohne Menü), Pflicht bei Zusage, Menüspalte und
// Küchenübersicht mit CSV in der Verwaltung, Client-API.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: true, askAlcohol: false, askAllergies: true })

async function newGuest(browser: Browser) {
  return (await browser.newContext()).newPage()
}

async function menuEvent(ownerId: Parameters<typeof createEvent>[0], data: Parameters<typeof createEvent>[1] = {}) {
  const event = await createEvent(ownerId, { formConfig: FORM, maxCompanions: 2, ...data })
  const main = await prisma.menuCourse.create({ data: { eventId: event.id, label: 'Hauptgang', options: JSON.stringify(['Fisch', 'Fleisch', 'Vegetarisch']), position: 0 } })
  const dessert = await prisma.menuCourse.create({ data: { eventId: event.id, label: 'Dessert', options: JSON.stringify(['Eis', 'Obst']), position: 1 } })
  return { event, main, dessert }
}

test('Termin-Formular: Gänge speichern, Fehler ändern nichts, gewählte Option bleibt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = await readForm(page, 'form:has(textarea[name="menu"])')
  const courses = async () => (await prisma.menuCourse.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } })).map(c => [c.label, JSON.parse(c.options)])

  await submitForm(page, form, { menu: 'Hauptgang: Fisch; Fleisch\nDessert: Eis' })
  expect(await courses()).toEqual([['Hauptgang', ['Fisch', 'Fleisch']], ['Dessert', ['Eis']]])

  // Ungültig: nichts gespeichert, auch nicht der Titel
  await submitForm(page, form, { menu: 'Hauptgang Fisch', title: 'Geändert' })
  expect(await courses()).toEqual([['Hauptgang', ['Fisch', 'Fleisch']], ['Dessert', ['Eis']]])
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe(event.title)

  // "Fisch" wurde gewählt: Option und Gang lassen sich nicht entfernen
  const { rsvp } = await createRsvp(event)
  const fish = await prisma.menuCourse.findFirstOrThrow({ where: { eventId: event.id, label: 'Hauptgang' } })
  await prisma.rsvpPerson.create({ data: { rsvpId: rsvp.id, position: 0, name: 'Gast', isAttending: true, menuChoices: { create: { courseId: fish.id, option: 'Fisch' } } } })
  await submitForm(page, form, { menu: 'Hauptgang: Fleisch\nDessert: Eis', title: 'Geändert' })
  await submitForm(page, form, { menu: 'Dessert: Eis', title: 'Geändert' })
  expect(await courses()).toEqual([['Hauptgang', ['Fisch', 'Fleisch']], ['Dessert', ['Eis']]])
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe(event.title)

  // Positivkontrolle: Option ergänzen, ungewählten Gang entfernen - die Wahl bleibt
  await submitForm(page, form, { menu: 'Hauptgang: Fisch; Fleisch; Vegetarisch' })
  expect(await courses()).toEqual([['Hauptgang', ['Fisch', 'Fleisch', 'Vegetarisch']]])
  expect(await prisma.menuChoice.count({ where: { courseId: fish.id } })).toBe(1)
  await page.reload()
  await expect(page.locator('textarea[name="menu"]')).toHaveValue('Hauptgang: Fisch; Fleisch; Vegetarisch')
})

test('Gäste wählen pro Person, Kleinkinder ohne Menü; Verwaltung, Küchenübersicht und CSV', async ({ browser, page }) => {
  const owner = await createAccount('CREATOR')
  const { event, main, dessert } = await menuEvent(owner)

  const guest = await newGuest(browser)
  await guest.goto(`/${event.slug}`)
  await guest.getByLabel('Dein Name').fill('Anna')
  await guest.locator('input[name="isAttending"][value="true"]').check()
  await guest.locator('#dietaryOption').selectOption('Allesesser')
  await guest.locator(`#menu_${main.id}`).selectOption('Fisch')
  await guest.locator(`#menu_${dessert.id}`).selectOption('Eis')
  await guest.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await guest.getByLabel('Name der 1. Begleitung').fill('Ben')
  await guest.locator('select[name="companion_0_age"]').selectOption('CHILD')
  await guest.getByLabel('Allergien der 1. Begleitung').fill('Nüsse')
  await guest.locator(`#companion_0_menu_${main.id}`).selectOption('Vegetarisch')
  await guest.locator(`#companion_0_menu_${dessert.id}`).selectOption('Obst')
  await guest.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await guest.getByLabel('Name der 2. Begleitung').fill('Mia')
  await guest.locator('select[name="companion_1_age"]').selectOption('INFANT')
  // Kleinkinder wählen kein Menü
  await expect(guest.locator(`#companion_1_menu_${main.id}`)).toHaveCount(0)
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()

  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true, persons: { orderBy: { position: 'asc' }, include: { menuChoices: true } } } })
  const choices = rsvp.persons.map(p => [p.name, Object.fromEntries(p.menuChoices.map(c => [c.courseId, c.option]))])
  expect(choices).toEqual([['Anna', { [main.id]: 'Fisch', [dessert.id]: 'Eis' }], ['Ben', { [main.id]: 'Vegetarisch', [dessert.id]: 'Obst' }], ['Mia', {}]])

  // Über den persönlichen Link ist die Wahl vorausgefüllt
  await guest.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
  await expect(guest.locator(`#menu_${main.id}`)).toHaveValue('Fisch')
  await expect(guest.locator(`#companion_0_menu_${dessert.id}`)).toHaveValue('Obst')

  // Verwaltung: Menüspalte, Link zur Küchenübersicht
  await login(page, owner.email)
  await expect(page.getByText('Anna: Hauptgang: Fisch, Dessert: Eis; Ben: Hauptgang: Vegetarisch, Dessert: Obst')).toBeVisible()
  await page.getByRole('link', { name: /Küchenübersicht/ }).first().click()
  await expect(page.getByTestId('kitchen-totals')).toContainText('3 Personen mit festem Platz: 1 Erwachsene, 1 Kinder, 1 Kleinkinder')
  const courses = page.getByTestId('kitchen-courses')
  await expect(courses.getByRole('row', { name: /^Fisch 1 0 1$/ })).toBeVisible()
  await expect(courses.getByRole('row', { name: /^Vegetarisch 0 1 1$/ })).toBeVisible()
  await expect(page.getByTestId('kitchen-allergies')).toContainText('Ben: Nüsse')
  await expect(page.getByTestId('kitchen-diets')).toContainText('Allesesser 1')

  const csv = await (await page.request.get(`/api/export/kueche?eventId=${event.id}`, { headers: await cookieHeader(page.context()) })).text()
  expect(csv).toContain('"Platz";"Name";"Antwort";"Alter";"Hauptgang";"Dessert";"Essen";"Allergien"')
  expect(csv).toContain('"";"Ben";"Anna";"Kind";"Vegetarisch";"Obst";"";"Nüsse"')

  // Fremdes Konto: weder Seite noch CSV
  const stranger = await createAccount('CREATOR')
  const strangerPage = await newGuest(browser)
  await login(strangerPage, stranger.email)
  expect((await strangerPage.goto(`/admin/kueche/${event.id}`))!.status()).toBe(404)
  expect((await strangerPage.request.get(`/api/export/kueche?eventId=${event.id}`, { headers: await cookieHeader(strangerPage.context()) })).status()).toBe(404)
  // Positivkontrolle: Moderator*in mit Freigabe
  const moderator = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })
  const modPage = await newGuest(browser)
  await login(modPage, moderator.email)
  expect((await modPage.goto(`/admin/kueche/${event.id}`))!.status()).toBe(200)
})

test('Client-API: Menü Pflicht für jede Person, nur Optionen des Termins', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series, { maxCompanions: 1 })
  const course = await prisma.menuCourse.create({ data: { eventId: termin.id, label: 'Hauptgang', options: JSON.stringify(['Fisch', 'Fleisch']), position: 0 } })
  const other = await createEvent(owner)
  const foreign = await prisma.menuCourse.create({ data: { eventId: other.id, label: 'Hauptgang', options: JSON.stringify(['Fisch']), position: 0 } })
  const guestUser = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guestUser.id, seriesId: series.id } })
  const authorization = `Bearer ${await createApiToken(guestUser)}`
  const post = (data: object) => request.post(`/api/v1/termine/${termin.id}/antwort`, { data, headers: { authorization } })

  const none = await post({ isAttending: true })
  expect(none.status()).toBe(400)
  expect((await none.json()).error).toContain('Menü')
  // Gang eines anderen Termins oder unbekannte Option zählen nicht
  expect((await post({ isAttending: true, menu: { [foreign.id]: 'Fisch' } })).status()).toBe(400)
  expect((await post({ isAttending: true, menu: { [course.id]: 'Hummer' } })).status()).toBe(400)
  // Begleitung ohne Menü
  expect((await post({ isAttending: true, menu: { [course.id]: 'Fisch' }, companions: [{ name: 'Lia' }] })).status()).toBe(400)
  expect(await prisma.rsvp.count({ where: { eventId: termin.id } })).toBe(0)

  // Positivkontrolle; Absage braucht kein Menü und behält die Wahl
  expect((await post({ isAttending: true, menu: { [course.id]: 'Fisch' }, companions: [{ name: 'Lia', menu: { [course.id]: 'Fleisch' } }] })).status()).toBe(200)
  expect((await post({ isAttending: false })).status()).toBe(200)
  const persons = await prisma.rsvpPerson.findMany({ where: { rsvp: { eventId: termin.id } }, orderBy: { position: 'asc' }, include: { menuChoices: true } })
  expect(persons.map(p => [p.name, p.isAttending, p.menuChoices.map(c => c.option)])).toEqual([[guestUser.name, false, ['Fisch']], ['Lia', false, ['Fleisch']]])

  const list = await (await request.get('/api/v1/termine', { headers: { authorization } })).json()
  const mine = list.series[0].events.find((e: { id: string }) => e.id === termin.id)
  expect(mine.menuCourses).toEqual([{ id: course.id, label: 'Hauptgang', options: ['Fisch', 'Fleisch'] }])
  expect(mine.myRsvp.menu).toEqual({ [course.id]: 'Fisch' })
  expect(mine.myRsvp.companions[0].menu).toEqual({ [course.id]: 'Fleisch' })
})
