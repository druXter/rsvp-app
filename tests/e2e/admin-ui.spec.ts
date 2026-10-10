import { expect, test } from '@playwright/test'
import { BASE_URL, createAccount, createEvent, createRsvp, createSeries, createTermin, login, prisma, readForm, submitForm } from './helpers'

// Neue Oberfläche der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): Übersicht, Event-Seite mit Reitern, kurzes Anlegen
// mit Arten, Weiterleitung der alten Adressen, Rechte von Moderator*innen auf der Event-Seite.

const DAY = 24 * 60 * 60 * 1000

test('Neues Event: Grunddaten und Art, URL-Wort aus dem Titel, danach in den passenden Bereich', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const title = `Hochzeit Lena & Max ${Date.now()}`

  await page.goto('/admin')
  await page.getByRole('link', { name: '+ Neues Event' }).click()
  await page.getByLabel('Titel', { exact: true }).fill(title)
  await page.getByLabel('Datum und Uhrzeit').fill('2027-05-30T15:00')
  await page.getByLabel('Ort (optional)').fill('Schloss')
  await page.getByRole('radio', { name: 'Hochzeit oder Feier mit Einladungen' }).check()
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await page.waitForURL(/\/admin\/events\/[^/]+\/einladungen$/)
  const wedding = await prisma.event.findFirstOrThrow({ where: { title } })
  expect(wedding).toMatchObject({ inviteOnly: true, ownerId: owner.id, location: 'Schloss', slug: expect.stringMatching(/^hochzeit-lena-max-\d+$/) })
  expect(JSON.parse(wedding.formConfig!)).toMatchObject({ askEmail: true, askDiet: true, askAllergies: true })

  // Gleicher Titel noch einmal, als Ball: URL-Wort eindeutig, weiter zu den Tickets
  await page.goto('/admin/create')
  await page.getByLabel('Titel', { exact: true }).fill(title)
  await page.getByLabel('Datum und Uhrzeit').fill('2027-01-20T19:00')
  await page.getByRole('radio', { name: 'Ball oder Event mit Tickets' }).check()
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await page.waitForURL(/einstellungen\?neu=1&abschnitt=tickets$/)
  await expect(page.getByTestId('section-tickets')).toHaveAttribute('open', '')
  await expect(page.getByTestId('section-grunddaten')).not.toHaveAttribute('open', '')
  const ball = await prisma.event.findFirstOrThrow({ where: { title, NOT: { id: wedding.id } } })
  expect(ball).toMatchObject({ enableCheckin: true, inviteOnly: false, slug: `${wedding.slug}-2` })

  // Hochzeit mit Konto-Pflicht passt nicht zusammen: nichts angelegt
  await page.goto('/admin/create')
  await page.getByLabel('Titel', { exact: true }).fill(`${title} Konto`)
  await page.getByLabel('Datum und Uhrzeit').fill('2027-01-20T19:00')
  await page.getByRole('radio', { name: 'Hochzeit oder Feier mit Einladungen' }).check()
  await page.getByText('Weitere Optionen').click()
  await page.getByLabel(/Nur mit Teilnehmendenkonto/).check()
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await expect.poll(() => prisma.event.count({ where: { title: `${title} Konto` } })).toBe(0)

  // Moderator*innen legen keine Events an (Positivkontrolle: der Owner oben)
  const moderator = await createAccount('MODERATOR')
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await expect(modPage.getByRole('link', { name: '+ Neues Event' })).toHaveCount(0)
  await modPage.goto('/admin')
  const form = await readForm(page, 'form:has(input[name="preset"])')
  await submitForm(modPage, { ...form }, { title: `${title} Mod` })
  expect(await prisma.event.count({ where: { title: `${title} Mod` } })).toBe(0)
})

test('Übersicht: anstehend mit Zahlen, Reihen, vergangen eingeklappt; Event-Seite mit Reitern', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const upcoming = await createEvent(owner, { title: 'Bald ' + Date.now(), maxCapacity: 10, date: new Date(Date.now() + 5 * DAY) })
  await createRsvp(upcoming)
  await createRsvp(upcoming, { isOnWaitlist: true })
  await createRsvp(upcoming, { isAttending: false })
  const past = await createEvent(owner, { title: 'Vorbei ' + Date.now(), date: new Date(Date.now() - 5 * DAY) })
  const series = await createSeries(owner)
  const termin = await createTermin(series, { title: 'Termin ' + Date.now(), date: new Date(Date.now() + 2 * DAY) })

  await login(page, owner.email)
  const row = page.getByTestId('event-row').filter({ hasText: upcoming.title })
  await expect(row.getByTestId('event-row-stats')).toContainText('1 Zusage')
  await expect(row.getByTestId('event-row-stats')).toContainText('1 Absagen')
  await expect(row.getByTestId('event-row-stats')).toContainText('1 Warteliste')
  await expect(row).toContainText('1 von 10 Plätzen')
  await expect(page.getByTestId('series-card').filter({ hasText: series.title })).toContainText(termin.title)
  await expect(page.getByText(past.title)).toBeHidden()
  await page.getByText(/Vergangen \(\d+\)/).click()
  await expect(page.getByText(past.title)).toBeVisible()

  await row.click()
  await page.waitForURL(`**/admin/events/${upcoming.id}`)
  await expect(page.getByRole('link', { name: 'Gäste (3)' })).toBeVisible()
  await expect(page.getByTestId('stat-waitlist')).toContainText('1')
  await page.getByRole('link', { name: 'Gäste (3)' }).click()
  await expect(page.getByTestId('guest-row')).toHaveCount(3)
  await page.getByRole('link', { name: /^Warteliste/ }).click()
  await expect(page.getByTestId('guest-row')).toHaveCount(1)
  await expect(page.getByTestId('guest-row')).toContainText('Warteliste')
  // Suche
  const name = (await prisma.participant.findFirstOrThrow({ where: { rsvps: { some: { eventId: upcoming.id, isAttending: false } } } })).name
  await page.goto(`/admin/events/${upcoming.id}/gaeste?q=${encodeURIComponent(name)}`)
  await expect(page.getByTestId('guest-row')).toHaveCount(1)
  await expect(page.getByTestId('guest-row')).toContainText('Abgesagt')
})

test('Alte Adressen leiten auf die Reiter weiter; Moderator*innen ohne Einstellungen; Fremde 404', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  for (const [old, tab] of [[`/admin/edit/${event.id}`, 'einstellungen'], [`/admin/kueche/${event.id}`, 'kueche'], [`/admin/zahlungen/${event.id}?markiert=2`, 'zahlungen?markiert=2'], [`/admin/einladungen/${event.id}`, 'einladungen']]) {
    await page.goto(old)
    expect(page.url()).toBe(`${BASE_URL}/admin/events/${event.id}/${tab}`)
  }
  // Speichern führt zurück in die Einstellungen
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await page.getByLabel('Titel', { exact: true }).fill('Neuer Titel')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByRole('status')).toContainText('Gespeichert')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Neuer Titel')

  const moderator = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}`)
  await expect(modPage.getByRole('link', { name: /^Gäste \(/ })).toBeVisible()
  await expect(modPage.getByRole('link', { name: 'Einstellungen' })).toHaveCount(0)
  await expect(modPage.getByRole('button', { name: /Jetzt an .* senden/ })).toHaveCount(0)
  expect((await modPage.goto(`/admin/events/${event.id}/einstellungen`))!.status()).toBe(404)

  const stranger = await createAccount('CREATOR')
  const strangerPage = await browser.newPage()
  await login(strangerPage, stranger.email)
  for (const tab of ['', '/gaeste', '/kueche', '/einstellungen']) {
    expect((await strangerPage.goto(`/admin/events/${event.id}${tab}`))!.status()).toBe(404)
  }
})

test('Gästeseite zeigt Titel, Datum, Ort und Beschreibung', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { title: 'Grillfest', location: 'Rheinufer', description: 'Bringt gute Laune mit!' })
  await page.goto(`/${event.slug}`)
  const header = page.getByTestId('event-header')
  await expect(header.getByRole('heading', { name: 'Grillfest' })).toBeVisible()
  await expect(header).toContainText('Rheinufer')
  await expect(header).toContainText('Bringt gute Laune mit!')
})
