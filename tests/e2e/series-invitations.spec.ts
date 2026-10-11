import { randomUUID } from 'crypto'
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import { BASE_URL, cookieHeader, createAccount, createRsvp, createSeries, createTermin, login, prisma, readForm, submitForm } from './helpers'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Einladungsmodus für Reihen (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): Schalter an der Reihe (gespiegelt auf die
// Termine, nicht mit Ticketkategorien), eine Einladungsliste für die Reihe mit Auswahl der Termine, ein Link pro
// Haushalt, Antwort pro Termin und Person, Sperre ohne passende Einladung - auch serverseitig.

const DAY = 24 * 60 * 60 * 1000

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

const attending = (page: Page, name: string, value: 'kommt' | 'kommt nicht') =>
  page.getByRole('radiogroup', { name: `Kommt ${name}?` }).getByLabel(value, { exact: true }).check()

async function seriesWithTermine(ownerId: Parameters<typeof createSeries>[0]) {
  const series = await createSeries(ownerId, { title: 'Hochzeit ' + randomUUID().slice(0, 6), description: 'Geheime Reihe' })
  const polterabend = await createTermin(series, { title: 'Polterabend', date: new Date(Date.now() + 20 * DAY) })
  const feier = await createTermin(series, { title: 'Feier', date: new Date(Date.now() + 21 * DAY), maxCapacity: 50 })
  return { series, polterabend, feier }
}

test('Verwaltung: Schalter an der Reihe (nicht mit Kategorien), Einladungen für alle bzw. ausgewählte Termine, Bearbeiten', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const { series, polterabend, feier } = await seriesWithTermine(owner)
  const category = await prisma.ticketCategory.create({ data: { eventId: feier.id, label: 'Gast', priceCents: 0, position: 0 } })
  await login(page, owner.email)

  // Mit Ticketkategorien an einem Termin geht der Einladungsmodus nicht
  await page.goto(`/admin/series/${series.id}/edit`)
  const settings = await readForm(page, '#edit-series-form')
  await submitForm(page, settings, { inviteOnly: 'on' })
  expect((await prisma.eventSeries.findUniqueOrThrow({ where: { id: series.id } })).inviteOnly).toBe(false)
  await prisma.ticketCategory.delete({ where: { id: category.id } })
  await page.goto(`/admin/series/${series.id}/edit`)
  await page.getByLabel('💌 Nur mit Einladung').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(/gespeichert=1/)
  expect((await prisma.event.findMany({ where: { seriesId: series.id } })).every(e => e.inviteOnly)).toBe(true)

  // Neuer Termin übernimmt den Modus
  await page.goto(`/admin/series/${series.id}`)
  await page.getByText('+ Termin hinzufügen').click()
  await page.getByLabel('Titel des Termins').fill('Brunch')
  await page.getByLabel('Datum und Uhrzeit').fill('2027-06-01T11:00')
  await page.getByRole('button', { name: 'Termin anlegen' }).click()
  await page.waitForURL(/einstellungen\?neu=1/)
  expect((await prisma.event.findFirstOrThrow({ where: { seriesId: series.id, title: 'Brunch' } })).inviteOnly).toBe(true)

  // Einladungen: Familie zu allen Terminen, Tante Erna nur zur Feier
  await page.goto(`/admin/series/${series.id}/einladungen`)
  await page.getByLabel('Neue Einladungen, eine Zeile pro Haushalt').fill('Familie Müller; Anna, Ben (Kind)')
  await page.getByRole('button', { name: 'Einladungen anlegen' }).click()
  await expect(page.getByText('1 Einladung(en) angelegt')).toBeVisible()
  await page.getByLabel('Neue Einladungen, eine Zeile pro Haushalt').fill('Tante Erna; erna@example.test')
  const newForm = page.locator('form').filter({ has: page.getByLabel('Neue Einladungen, eine Zeile pro Haushalt') })
  await newForm.getByLabel('nur diesen:').check()
  await newForm.getByRole('checkbox', { name: /^Feier/ }).check()
  const captured = page.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'] && (r.postData() ?? '').includes('Tante Erna'))
  await page.getByRole('button', { name: 'Einladungen anlegen' }).click()
  await expect.poll(() => prisma.invitation.count({ where: { seriesId: series.id } })).toBe(2)

  const invitations = await prisma.invitation.findMany({ where: { seriesId: series.id }, include: { participant: true, events: true }, orderBy: { createdAt: 'asc' } })
  expect(invitations.map(i => [i.label, i.allEvents, i.events.map(e => e.eventId), i.participant.seriesId, i.eventId])).toEqual([
    ['Familie Müller', true, [], series.id, null], ['Tante Erna', false, [feier.id], series.id, null]
  ])
  await page.reload()
  await expect(page.getByTestId('invitation').filter({ hasText: 'Tante Erna' }).getByTestId('invitation-termine')).toContainText('Eingeladen zu: Feier')
  await expect(page.getByTestId('invitation').filter({ hasText: 'Tante Erna' }).getByTestId('invitation-termin')).toHaveCount(1)
  await expect(page.getByTestId('invitation').filter({ hasText: 'Familie Müller' }).getByTestId('invitation-termin')).toHaveCount(3)
  await expect(page.getByLabel('Link für Familie Müller')).toHaveValue(`${BASE_URL}/reihe/${series.slug}?token=${invitations[0].participant.editToken}`)
  // Termin-Reiter zeigt den Stand der Reihen-Einladungen für genau diesen Termin
  await page.goto(`/admin/events/${polterabend.id}/einladungen`)
  await expect(page.getByTestId('invitation-summary')).toContainText('1 Haushalte zu diesem Termin eingeladen')
  await page.goto(`/admin/events/${feier.id}/einladungen`)
  await expect(page.getByTestId('invitation-summary')).toContainText('2 Haushalte zu diesem Termin eingeladen')
  await page.goto(`/admin/einladungen/reihe/${series.id}/druck`)
  await expect(page.getByTestId('invitation-card')).toHaveCount(2)

  // Fremdes Konto: weder Seite noch Anlegen (Positivkontrolle: der Owner oben)
  const stranger = await createAccount('CREATOR')
  const strangerPage = await newPage(browser)
  await login(strangerPage, stranger.email)
  expect((await strangerPage.goto(`/admin/series/${series.id}/einladungen`))!.status()).toBe(404)
  expect((await strangerPage.goto(`/admin/einladungen/reihe/${series.id}/druck`))!.status()).toBe(404)
  const request: Request = await captured
  const replay = await strangerPage.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL, ...(await cookieHeader(strangerPage.context())) },
    data: request.postDataBuffer()!.toString('utf8').replace('Tante Erna; erna@example.test', 'Eindringling')
  })
  expect(await replay.text()).toContain('nicht gefunden')
  expect(await prisma.invitation.count({ where: { seriesId: series.id } })).toBe(2)
})

test('Gäste: ein Link für die eingeladenen Termine, Antwort pro Termin und Person, Sperre auch serverseitig', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const { series, polterabend, feier } = await seriesWithTermine(owner)
  await prisma.eventSeries.update({ where: { id: series.id }, data: { inviteOnly: true } })
  await prisma.event.updateMany({ where: { seriesId: series.id }, data: { inviteOnly: true } })
  const family = await prisma.invitation.create({
    data: {
      series: { connect: { id: series.id } }, label: 'Familie Müller',
      participant: { create: { name: 'Familie Müller', editToken: randomUUID(), seriesId: series.id } },
      persons: { create: [{ name: 'Anna', position: 0 }, { name: 'Ben', ageGroup: 'CHILD', position: 1 }] }
    },
    include: { participant: true, persons: { orderBy: { position: 'asc' } } }
  })
  const erna = await prisma.invitation.create({
    data: {
      series: { connect: { id: series.id } }, label: 'Tante Erna', allEvents: false, events: { create: { eventId: feier.id } },
      participant: { create: { name: 'Tante Erna', editToken: randomUUID(), seriesId: series.id } },
      persons: { create: [{ name: 'Erna', position: 0 }] }
    },
    include: { participant: true }
  })
  // Teilnehmer*in einer anderen Reihe
  const otherSeries = await createSeries(owner)
  const otherTermin = await createTermin(otherSeries)
  const { participant: foreign } = await createRsvp(otherTermin)

  // Ohne, mit fremdem oder erfundenem Link: nur der Titel der Reihe, keine Termine, kein Formular
  const visitor = await newPage(browser)
  for (const query of ['', `?token=${foreign.editToken}`, `?token=${randomUUID()}`]) {
    await visitor.goto(`/reihe/${series.slug}${query}`)
    await expect(visitor.getByTestId('invitation-gate')).toBeVisible()
    expect(await visitor.content()).not.toContain('Polterabend')
    await visitor.goto(`/reihe/${series.slug}/${feier.slug}${query}`)
    await expect(visitor.getByTestId('invitation-gate')).toBeVisible()
    expect(await visitor.content()).not.toContain('Geheime Reihe')
  }
  expect((await visitor.goto(`/reihe/${series.slug}/registrieren`))!.status()).toBe(404)
  expect((await visitor.request.get(`/api/ical/${polterabend.id}`)).status()).toBe(403)

  // Tante Erna: nur die Feier
  const guest = await newPage(browser)
  await guest.goto(`/reihe/${series.slug}?token=${erna.participant.editToken}`)
  await expect(guest.getByTestId('series-invitation')).toContainText('Einladung für Tante Erna')
  await expect(guest.getByText('Feier')).toBeVisible()
  await expect(guest.getByText('Polterabend')).toHaveCount(0)
  await guest.goto(`/reihe/${series.slug}/${polterabend.slug}?token=${erna.participant.editToken}`)
  await expect(guest.getByTestId('invitation-gate')).toBeVisible()
  expect((await guest.request.get(`/api/ical/${polterabend.id}?token=${erna.participant.editToken}`)).status()).toBe(403)
  expect((await guest.request.get(`/api/ical/${feier.id}?token=${erna.participant.editToken}`)).status()).toBe(200)
  await guest.goto(`/reihe/${series.slug}/${feier.slug}?token=${erna.participant.editToken}`)
  await expect(guest.getByText('💌 Einladung für Tante Erna')).toBeVisible()
  await attending(guest, 'Erna', 'kommt')
  const captured = guest.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'] && (r.postData() ?? '').includes('householdShown'))
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()
  await guest.goto(`/reihe/${series.slug}?token=${erna.participant.editToken}`)
  await expect(guest.getByTestId('termin-answer')).toHaveText('zugesagt')

  // Dieselbe Antwort auf den Polterabend abgespielt: abgelehnt (Positivkontrolle: die Feier oben)
  const request: Request = await captured
  const original = request.postDataBuffer()!.toString('utf8')
  const response = await guest.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL, ...(await cookieHeader(guest.context())) },
    data: original.replaceAll(feier.id, polterabend.id)
  })
  expect(await response.text()).toContain('persönliche Einladung')
  expect(await prisma.rsvp.count({ where: { eventId: polterabend.id } })).toBe(0)

  // Familie: beide Termine, unterschiedlich pro Person
  const familyPage = await newPage(browser)
  await familyPage.goto(`/reihe/${series.slug}?token=${family.participant.editToken}`)
  await expect(familyPage.getByTestId('termin-answer')).toHaveText(['noch offen', 'noch offen'])
  await familyPage.getByText('Polterabend').click()
  await attending(familyPage, 'Anna', 'kommt')
  await attending(familyPage, 'Ben', 'kommt nicht')
  await familyPage.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(familyPage.getByText('Danke für deine Anmeldung!')).toBeVisible()
  await familyPage.goto(`/reihe/${series.slug}/${feier.slug}?token=${family.participant.editToken}`)
  await attending(familyPage, 'Anna', 'kommt')
  await attending(familyPage, 'Ben', 'kommt')
  await familyPage.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(familyPage.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const answers = await prisma.rsvp.findMany({ where: { participantId: family.participantId }, include: { persons: { orderBy: { position: 'asc' } } } })
  const byEvent = (id: string) => answers.find(a => a.eventId === id)!.persons.map(p => [p.name, p.isAttending, p.invitationPersonId])
  expect(byEvent(polterabend.id)).toEqual([['Anna', true, family.persons[0].id], ['Ben', false, family.persons[1].id]])
  expect(byEvent(feier.id)).toEqual([['Anna', true, family.persons[0].id], ['Ben', true, family.persons[1].id]])

  // Verwaltung: Stand pro Termin; Familie nur noch zum Polterabend -> ihre Antwort zur Feier fällt weg, Platz wird frei
  await login(page, owner.email)
  await page.goto(`/admin/series/${series.id}/einladungen`)
  await expect(page.getByTestId('termin-summary').filter({ hasText: 'Feier' })).toContainText('2 Haushalte (0 ohne Antwort) · 3 kommen')
  const card = page.getByTestId('invitation').filter({ hasText: 'Familie Müller' })
  await card.getByText('Bearbeiten').click()
  await card.getByLabel('nur diesen:').check()
  await card.getByRole('checkbox', { name: /^Polterabend/ }).check()
  await card.getByRole('button', { name: 'Speichern' }).click()
  await expect(card.getByText('Gespeichert')).toBeVisible()
  expect((await prisma.rsvp.findMany({ where: { participantId: family.participantId } })).map(r => r.eventId)).toEqual([polterabend.id])
  await familyPage.goto(`/reihe/${series.slug}/${feier.slug}?token=${family.participant.editToken}`)
  await expect(familyPage.getByTestId('invitation-gate')).toBeVisible()
})

test('Erinnerung pro Termin: nur Haushalte, die zu diesem Termin eingeladen sind und dort noch nicht geantwortet haben', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const { series, polterabend, feier } = await seriesWithTermine(owner)
  await prisma.event.updateMany({ where: { seriesId: series.id }, data: { inviteOnly: true } })
  await prisma.event.update({ where: { id: feier.id }, data: { rsvpDeadline: new Date(Date.now() + 3 * DAY), rsvpReminderDays: 7 } })
  const invite = (label: string, data: object = {}) => prisma.invitation.create({
    data: {
      series: { connect: { id: series.id } }, label, email: `${randomUUID().slice(0, 8)}@example.test`, ...data,
      participant: { create: { name: label, editToken: randomUUID(), seriesId: series.id } },
      persons: { create: [{ name: label, position: 0 }] }
    }
  })
  const silent = await invite('Still')
  const onlyPolterabend = await invite('Nur Polterabend', { allEvents: false, events: { create: { eventId: polterabend.id } } })
  const answered = await invite('Geantwortet')
  await prisma.rsvp.create({ data: { eventId: feier.id, participantId: answered.participantId, isAttending: true } })

  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  const reminders = async (invitationId: string) => (await prisma.invitationReminder.findMany({ where: { invitationId } })).map(r => r.eventId)
  expect(await reminders(silent.id)).toEqual([feier.id])
  expect(await reminders(onlyPolterabend.id)).toEqual([])
  expect(await reminders(answered.id)).toEqual([])
})
