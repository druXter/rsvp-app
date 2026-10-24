import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  cookieHeader, createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin, login, prisma, readForm, submitForm
} from './helpers'

// Begleitungen und Angaben pro Person (docs/KONZEPT-EINLADUNGEN.md, app/lib/persons.ts): "bis zu N Begleitungen"
// im Termin-Formular, Begleitungen mit Altersgruppe, Essen und Allergien im Gästeformular, Plätze zählen Personen
// (Kleinkinder nicht), Warteliste und Nachrücken als Ganzes, Verwaltung, Einlass, CSV und Client-API.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: true, askAlcohol: false, askAllergies: true })

async function newGuest(browser: Browser) {
  return (await browser.newContext()).newPage()
}

/** Antwortet über das Gästeformular mit Begleitungen (Name, Altersgruppe). */
async function answer(page: Page, slug: string, name: string, companions: { name: string; age?: string }[], query = '') {
  await page.goto(`/${slug}${query}`)
  await page.getByLabel('Dein Name').fill(name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.locator('#dietaryOption').selectOption('Vegetarisch')
  for (const [i, companion] of companions.entries()) {
    await page.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
    await page.getByLabel(`Name der ${i + 1}. Begleitung`).fill(companion.name)
    if (companion.age) await page.locator(`select[name="companion_${i}_age"]`).selectOption(companion.age)
  }
  await page.getByRole('button', { name: /Antwort absenden|Änderungen speichern/ }).click()
}

const rsvpOf = (eventId: string, name: string) =>
  prisma.rsvp.findFirstOrThrow({ where: { eventId, participant: { name } }, include: { participant: true, persons: { orderBy: { position: 'asc' } } } })

test('Termin-Formular: bis zu N Begleitungen, nicht zusammen mit Ticketkategorien', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = await readForm(page, 'form:has(input[name="maxCompanions"])')

  await submitForm(page, form, { maxCompanions: '3' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).maxCompanions).toBe(3)
  // Über dem Höchstwert wird gekappt, Unsinn wird 0
  await submitForm(page, form, { maxCompanions: '99' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).maxCompanions).toBe(20)

  // Mit Ticketkategorien abgelehnt - und nichts sonst gespeichert
  await submitForm(page, form, { maxCompanions: '2', ticketCategories: 'Studierende; 0', title: 'Geändert' })
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ maxCompanions: 20, title: event.title })
  expect(await prisma.ticketCategory.count({ where: { eventId: event.id } })).toBe(0)
  // Positivkontrolle: Kategorien ohne Begleitungen
  await submitForm(page, form, { maxCompanions: '0', ticketCategories: 'Studierende; 0' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).maxCompanions).toBe(0)
  expect(await prisma.ticketCategory.count({ where: { eventId: event.id } })).toBe(1)
  // ... und Begleitungen bei bestehenden Kategorien ebenso abgelehnt
  const saved = await readForm(page, 'form:has(input[name="maxCompanions"])')
  await submitForm(page, saved, { maxCompanions: '1' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).maxCompanions).toBe(0)
})

test('Gäste melden Begleitungen an; Plätze zählen Personen; Warteliste und Nachrücken als Ganzes', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM, maxCompanions: 2, maxCapacity: 5, isGuestListVisible: true })

  // Anna mit zwei Begleitungen, eine davon ein Kind - und ein Kleinkind passt nicht mehr (höchstens 2)
  const anna = await newGuest(browser)
  await anna.goto(`/${event.slug}`)
  await anna.locator('input[name="isAttending"][value="true"]').check()
  await expect(anna.getByTestId('companions')).toContainText('(bis zu 2)')
  await answer(anna, event.slug, 'Anna', [{ name: 'Ben' }, { name: 'Clara', age: 'CHILD' }])
  await expect(anna.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const annaRsvp = await rsvpOf(event.id, 'Anna')
  expect(annaRsvp.isOnWaitlist).toBe(false)
  expect(annaRsvp.persons.map(p => [p.position, p.name, p.ageGroup, p.isAttending, p.dietaryOption])).toEqual([
    [0, 'Anna', 'ADULT', true, 'Vegetarisch'], [1, 'Ben', 'ADULT', true, null], [2, 'Clara', 'CHILD', true, null]
  ])

  // Dora mit einer Begleitung braucht 2 Plätze, frei sind 2: fest. Danach ist voll.
  const dora = await newGuest(browser)
  await answer(dora, event.slug, 'Dora', [{ name: 'Dirk' }])
  await expect(dora.getByText('Danke für deine Anmeldung!')).toBeVisible()
  // Emil mit Kleinkind: braucht nur einen Platz, der fehlt aber -> Warteliste. Fynn mit Begleitung -> Warteliste.
  const emil = await newGuest(browser)
  await answer(emil, event.slug, 'Emil', [{ name: 'Mia', age: 'INFANT' }])
  await expect(emil.getByText('Du stehst auf der Warteliste!')).toBeVisible()
  const fynn = await newGuest(browser)
  await answer(fynn, event.slug, 'Fynn', [{ name: 'Frida' }])
  await expect(fynn.getByText('Du stehst auf der Warteliste!')).toBeVisible()

  // Anna will noch jemanden mitbringen, es ist voll: abgelehnt, bisherige Anmeldung bleibt
  await anna.goto(`/${event.slug}?token=${annaRsvp.participant.editToken}`)
  await expect(anna.getByLabel('Name der 2. Begleitung')).toHaveValue('Clara')
  await anna.getByLabel('Name der 2. Begleitung').fill('Carlo')
  await anna.locator('select[name="companion_1_age"]').selectOption('ADULT')
  await anna.getByRole('button', { name: 'Änderungen speichern' }).click()
  // Gleiche Personenzahl: geht (ein Kind wird zu einem Erwachsenen, ebenfalls ein Platz)
  await expect(anna.getByText('Danke für deine Anmeldung!')).toBeVisible()
  expect((await rsvpOf(event.id, 'Anna')).persons.map(p => p.name)).toEqual(['Anna', 'Ben', 'Carlo'])
  // Mehr als erlaubt geht im Formular gar nicht (Knopf fehlt), mehr Personen ohne Platz werden abgelehnt
  await prisma.event.update({ where: { id: event.id }, data: { maxCompanions: 3 } })
  await anna.goto(`/${event.slug}?token=${annaRsvp.participant.editToken}`)
  await anna.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await anna.getByLabel('Name der 3. Begleitung').fill('Dana')
  await anna.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(anna.locator('form p[role="alert"]')).toContainText('Für 4 Personen ist leider kein Platz mehr frei')
  expect((await rsvpOf(event.id, 'Anna')).persons).toHaveLength(3)

  // Anna nimmt Carlo raus: ein Platz frei - Emil (1 Platz, Kleinkind zählt nicht) rückt nach, nicht Fynn (2)
  await anna.goto(`/${event.slug}?token=${annaRsvp.participant.editToken}`)
  await anna.getByRole('button', { name: '2. Begleitung entfernen' }).click()
  await anna.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(anna.getByText('Danke für deine Anmeldung!')).toBeVisible()
  await expect.poll(async () => (await rsvpOf(event.id, 'Emil')).isOnWaitlist).toBe(false)
  expect((await rsvpOf(event.id, 'Fynn')).isOnWaitlist).toBe(true)

  // Öffentliche Gästeliste mit den Namen der Begleitungen
  await fynn.goto(`/${event.slug}`)
  await expect(fynn.getByText('(+ Ben)')).toBeVisible()
  await expect(fynn.getByText('(+ Mia)')).toBeVisible()

  // Dora sagt ab: zwei Plätze frei, Fynn rückt mit Begleitung nach
  const doraRsvp = await rsvpOf(event.id, 'Dora')
  await dora.goto(`/${event.slug}?token=${doraRsvp.participant.editToken}`)
  await dora.locator('input[name="isAttending"][value="false"]').check()
  await dora.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(dora.getByText('Schade, dass du nicht dabei bist!')).toBeVisible()
  await expect.poll(async () => (await rsvpOf(event.id, 'Fynn')).isOnWaitlist).toBe(false)
  // Absage behält die Begleitungen (für eine erneute Zusage), alle als abgesagt
  expect((await rsvpOf(event.id, 'Dora')).persons.map(p => [p.name, p.isAttending])).toEqual([['Dora', false], ['Dirk', false]])
})

test('Verwaltung: Begleitungen bearbeiten (ohne Höchstmaß), Übersicht, Einlass und CSV', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM, maxCompanions: 1, maxCapacity: 10, enableCheckin: true })
  const { rsvp } = await createRsvp(event, { name: 'Erika' })
  await login(page, owner.email)

  await page.goto(`/admin/edit-rsvp/${rsvp.id}`)
  await page.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await page.getByLabel('Name der 1. Begleitung').fill('Max')
  await page.locator('select[name="companion_0_diet"]').selectOption('Vegan')
  await page.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await page.getByLabel('Name der 2. Begleitung').fill('Mia')
  await page.locator('select[name="companion_1_age"]').selectOption('INFANT')
  await page.getByLabel('Allergien der 2. Begleitung').fill('Ei')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(`**/admin/events/${event.id}/gaeste`)
  const persons = await prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id }, orderBy: { position: 'asc' } })
  expect(persons.map(p => [p.name, p.ageGroup, p.dietaryOption, p.allergies])).toEqual([
    ['Erika', 'ADULT', null, null], ['Max', 'ADULT', 'Vegan', null], ['Mia', 'INFANT', null, 'Ei']
  ])

  await expect(page.getByTestId('guest-persons')).toHaveText('+ Max (Vegan); Mia (Kleinkind, Ei)')
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByTestId('stat-confirmed')).toContainText('2 Personen · 2 von 10 Plätzen')

  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByTestId('checkin-persons').getByRole('listitem')).toHaveText([/Erika/, /Max/, /Mia\s*Kleinkind/])

  const csv = await (await page.request.get(`/api/export?eventId=${event.id}`, { headers: await cookieHeader(page.context()) })).text()
  expect(csv).toContain(';"Personen";"Begleitungen";')
  expect(csv).toContain('"3";"Max (Vegan); Mia (Kleinkind, Ei)"')

  // Fremdes Konto: Bearbeiten wirkt nicht
  const stranger = await createAccount('CREATOR')
  const strangerPage = await newGuest(browser)
  await login(strangerPage, stranger.email)
  await expect(strangerPage.goto(`/admin/edit-rsvp/${rsvp.id}`).then(r => r!.text())).resolves.toContain('Antwort nicht gefunden')
})

test('Client-API: companions und plusOne, Höchstmaß wird geprüft', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series, { maxCompanions: 1, maxCapacity: 3 })
  const guestUser = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guestUser.id, seriesId: series.id } })
  const authorization = `Bearer ${await createApiToken(guestUser)}`
  const post = (data: object) => request.post(`/api/v1/termine/${termin.id}/antwort`, { data, headers: { authorization } })
  const persons = async () => (await prisma.rsvpPerson.findMany({ where: { rsvp: { eventId: termin.id } }, orderBy: { position: 'asc' } })).map(p => [p.name, p.ageGroup])

  const tooMany = await post({ isAttending: true, companions: [{ name: 'A' }, { name: 'B' }] })
  expect(tooMany.status()).toBe(400)
  expect((await tooMany.json()).error).toContain('Höchstens 1 Begleitung')
  expect(await prisma.rsvp.count({ where: { eventId: termin.id } })).toBe(0)

  expect((await post({ isAttending: true, companions: [{ name: ' Lia ', ageGroup: 'CHILD', allergies: 'Ei' }] })).status()).toBe(200)
  expect(await persons()).toEqual([[guestUser.name, 'ADULT'], ['Lia', 'CHILD']])
  // Ohne Feld bleiben die Begleitungen, plusOne als Kurzform ersetzt sie
  expect((await post({ isAttending: true })).status()).toBe(200)
  expect(await persons()).toEqual([[guestUser.name, 'ADULT'], ['Lia', 'CHILD']])
  expect((await post({ isAttending: true, plusOne: true, plusOneName: 'Max' })).status()).toBe(200)
  expect(await persons()).toEqual([[guestUser.name, 'ADULT'], ['Max', 'ADULT']])

  const list = await (await request.get('/api/v1/termine', { headers: { authorization } })).json()
  const mine = list.series[0].events.find((e: { id: string }) => e.id === termin.id)
  expect(mine.maxCompanions).toBe(1)
  expect(mine.myRsvp).toMatchObject({ plusOne: true, plusOneName: 'Max', companions: [{ name: 'Max', ageGroup: 'ADULT' }] })

  expect((await post({ isAttending: true, plusOne: false })).status()).toBe(200)
  expect(await persons()).toEqual([[guestUser.name, 'ADULT']])
})
