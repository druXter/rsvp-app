import { randomUUID } from 'crypto'
import { expect, test, type Browser } from '@playwright/test'
import { cookieHeader, createAccount, createEvent, login, prisma, readForm, submitForm } from './helpers'

// Alkohol und Einlass pro Person (docs/KONZEPT-EINLADUNGEN.md, app/lib/persons.ts, app/lib/checkin.ts): Alkohol für
// jede erwachsene Begleitung bzw. Person des Haushalts, Getränke in der Küche und in den CSVs; Scannen lässt alle
// herein, einzelne Personen lassen sich aus- und eintragen, der Einlass übersteht Änderungen der Antwort.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: true, askAllergies: false })

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

test('Alkohol pro Person: Begleitungen (nur Erwachsene) und Haushalte, Küche und CSV', async ({ browser, page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM, maxCompanions: 2 })

  const guest = await newPage(browser)
  await guest.goto(`/${event.slug}`)
  await guest.getByLabel('Dein Name').fill('Anna')
  await guest.locator('input[name="isAttending"][value="true"]').check()
  await guest.locator('input[name="drinksAlcohol"][value="false"]').check()
  await guest.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await guest.getByLabel('Name der 1. Begleitung').fill('Ben')
  await guest.getByLabel('Alkohol der 1. Begleitung').selectOption('true')
  await guest.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await guest.getByLabel('Name der 2. Begleitung').fill('Clara')
  await guest.locator('select[name="companion_1_age"]').selectOption('CHILD')
  // Kinder werden nicht nach Alkohol gefragt
  await expect(guest.getByLabel('Alkohol der 2. Begleitung')).toHaveCount(0)
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()

  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true, persons: { orderBy: { position: 'asc' } } } })
  expect(rsvp.drinksAlcohol).toBe(false)
  expect(rsvp.persons.map(p => [p.name, p.drinksAlcohol])).toEqual([['Anna', false], ['Ben', true], ['Clara', null]])
  // Über den persönlichen Link vorausgefüllt
  await guest.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
  await expect(guest.getByLabel('Alkohol der 1. Begleitung')).toHaveValue('true')

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/kueche`)
  await expect(page.getByTestId('kitchen-drinks')).toHaveText('Getränke (Erwachsene): 1 mit Alkohol · 1 nur alkoholfrei')
  const headers = await cookieHeader(page.context())
  const kitchen = await (await page.request.get(`/api/export/kueche?eventId=${event.id}`, { headers })).text()
  expect(kitchen).toContain(';Ben;Anna;Erwachsen;;;Ja')
  const guests = await (await page.request.get(`/api/export?eventId=${event.id}`, { headers })).text()
  expect(guests).toContain('"Anna: Nein; Ben: Ja"')

  // Haushalt: Frage pro erwachsener Person statt einmal für alle
  const wedding = await createEvent(owner, { formConfig: FORM, inviteOnly: true })
  const family = await prisma.invitation.create({
    data: {
      event: { connect: { id: wedding.id } }, label: 'Familie Müller',
      participant: { create: { name: 'Familie Müller', editToken: randomUUID() } },
      persons: { create: [{ name: 'Dora', position: 0 }, { name: 'Emil', ageGroup: 'CHILD', position: 1 }] }
    },
    include: { participant: true }
  })
  await guest.goto(`/${wedding.slug}?token=${family.participant.editToken}`)
  await guest.getByRole('radiogroup', { name: 'Kommt Dora?' }).getByLabel('kommt', { exact: true }).check()
  await guest.getByRole('radiogroup', { name: 'Kommt Emil?' }).getByLabel('kommt', { exact: true }).check()
  await expect(guest.locator('input[name="drinksAlcohol"]')).toHaveCount(0)
  await expect(guest.getByLabel('Alkohol von Emil')).toHaveCount(0)
  await guest.getByLabel('Alkohol von Dora').selectOption('true')
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const household = await prisma.rsvp.findFirstOrThrow({ where: { eventId: wedding.id }, include: { persons: { orderBy: { position: 'asc' } } } })
  expect(household.drinksAlcohol).toBeNull()
  expect(household.persons.map(p => [p.name, p.drinksAlcohol])).toEqual([['Dora', true], ['Emil', null]])
})

test('Einlass pro Person: Scannen lässt alle herein, einzeln aus- und eintragen, bleibt bei Änderungen', async ({ browser, page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM, maxCompanions: 2, enableCheckin: true })
  const guest = await newPage(browser)
  await guest.goto(`/${event.slug}`)
  await guest.getByLabel('Dein Name').fill('Anna')
  await guest.locator('input[name="isAttending"][value="true"]').check()
  await guest.locator('input[name="drinksAlcohol"][value="true"]').check()
  await guest.getByRole('button', { name: '+ Begleitung hinzufügen' }).click()
  await guest.getByLabel('Name der 1. Begleitung').fill('Ben')
  await guest.getByLabel('Alkohol der 1. Begleitung').selectOption('false')
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true } })
  const checkedIn = async () => (await prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id }, orderBy: { position: 'asc' } })).map(p => [p.name, !!p.checkedInAt])

  await login(page, owner.email)
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  const list = page.getByTestId('checkin-persons')
  await expect(list).toContainText('Anna')
  await expect(list).toContainText('Alkohol')
  await expect(list).toContainText('alkoholfrei')
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', true]])

  // Ben ist doch noch draußen: austragen - die Seite checkt danach nicht wieder alle ein
  await list.getByRole('listitem').filter({ hasText: 'Ben' }).getByRole('button', { name: 'Austragen' }).click()
  await page.waitForURL(`**/admin/checkin/${rsvp.id}?ansicht=1`)
  await expect(page.getByRole('heading', { name: '1 von 2 da' })).toBeVisible()
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', false]])
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByTestId('stat-checkin')).toContainText('1/2')

  // Gästeliste: Ben einzeln einlassen
  await page.goto(`/admin/events/${event.id}/gaeste`)
  await expect(page.getByTestId('guest-checkin')).toContainText('🎫 Da 1/2')
  await page.getByRole('button', { name: 'Ben einchecken' }).click()
  await expect(page.getByTestId('guest-checkin')).toContainText('🎫 Da 2/2')
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', true]])

  // Der Gast ändert seine Antwort: der Einlass bleibt
  await guest.goto(`/${event.slug}?token=${rsvp.participant.editToken}`)
  await guest.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', true]])

  // Alle austragen auf der Check-in-Seite, dann wieder alle einlassen
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Bereits eingecheckt' })).toBeVisible()
  await page.getByRole('button', { name: 'Alle austragen' }).click()
  await page.waitForURL(`**/admin/checkin/${rsvp.id}?ansicht=1`)
  await expect(page.getByRole('heading', { name: 'Nicht eingecheckt' })).toBeVisible()
  expect(await checkedIn()).toEqual([['Anna', false], ['Ben', false]])
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).hasAttended).toBe(false)
  await page.getByRole('button', { name: 'Alle einlassen' }).click()
  await expect(page.getByRole('heading', { name: 'Bereits eingecheckt' })).toBeVisible()
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', true]])

  // Fremdes Konto kann keine Person austragen (Positivkontrolle: Moderator*in mit Freigabe)
  await page.goto(`/admin/events/${event.id}/gaeste`)
  const form = await readForm(page, 'form:has(input[name="personId"])')
  const stranger = await createAccount('CREATOR')
  const strangerPage = await newPage(browser)
  await login(strangerPage, stranger.email)
  await submitForm(strangerPage, form)
  expect(await checkedIn()).toEqual([['Anna', true], ['Ben', true]])
  const moderator = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })
  const modPage = await newPage(browser)
  await login(modPage, moderator.email)
  await submitForm(modPage, form)
  expect(await checkedIn()).toEqual([['Anna', false], ['Ben', true]])
})
