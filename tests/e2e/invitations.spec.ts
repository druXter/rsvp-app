import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import type { Event, User } from '@prisma/client'
import {
  BASE_URL, cookieHeader, createAccount, createEvent, createRsvp, login, prisma, readForm, submitForm, withFreshPow
} from './helpers'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Einladungen pro Haushalt und Antwortfrist (docs/KONZEPT-EINLADUNGEN.md, Abschnitte 3 und 5,
// app/lib/invitations.ts, app/lib/invitation-store.ts, app/lib/rsvp-deadline.ts): Einladungsmodus im
// Termin-Formular, Einladungen anlegen/ändern/löschen, Antwort pro Person über den persönlichen Link,
// Sperre ohne Link, Frist mit Sperre und Erinnerung.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: true, askAlcohol: false, askAllergies: false })
const DAY = 24 * 60 * 60 * 1000

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

/** Einladung direkt in der Datenbank, wie createInvitations sie anlegt. */
async function invite(event: Event, label: string, persons: { name: string; ageGroup?: string }[], data: { email?: string; extraPersons?: number } = {}) {
  return prisma.invitation.create({
    data: {
      event: { connect: { id: event.id } },
      label,
      email: data.email ?? null,
      extraPersons: data.extraPersons ?? 0,
      participant: { create: { name: label, email: data.email ?? null, editToken: randomUUID() } },
      persons: { create: persons.map((p, position) => ({ name: p.name, ageGroup: p.ageGroup ?? 'ADULT', position })) }
    },
    include: { participant: true, persons: { orderBy: { position: 'asc' } } }
  })
}

async function inviteEvent(owner: User, data: Partial<Event> = {}) {
  return createEvent(owner, { formConfig: FORM, inviteOnly: true, title: 'Hochzeit ' + randomUUID().slice(0, 6), description: 'Geheime Beschreibung', location: 'Schloss', ...data })
}

const attending = (page: Page, name: string, value: 'kommt' | 'kommt nicht') =>
  page.getByRole('radiogroup', { name: `Kommt ${name}?` }).getByLabel(value, { exact: true }).check()

test('Termin-Formular: Einladungsmodus nur ohne PIN, Verifizierung und Ticketkategorien', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = await readForm(page, 'form:has(input[name="inviteOnly"])')
  const stored = () => prisma.event.findUniqueOrThrow({ where: { id: event.id } })

  await submitForm(page, form, { inviteOnly: 'on', eventPin: '1234', title: 'Geändert' })
  await submitForm(page, form, { inviteOnly: 'on', requireVerification: 'on', title: 'Geändert' })
  await submitForm(page, form, { inviteOnly: 'on', ticketCategories: 'Gäste; 0', title: 'Geändert' })
  expect(await stored()).toMatchObject({ inviteOnly: false, title: event.title, eventPin: null })

  // Positivkontrolle, mit Antwortfrist und Erinnerung
  await submitForm(page, form, { inviteOnly: 'on', rsvpDeadline: '2027-05-30', rsvpReminderDays: '7' })
  expect(await stored()).toMatchObject({ inviteOnly: true, rsvpReminderDays: 7 })
  expect((await stored()).rsvpDeadline!.toISOString()).toBe('2027-05-30T21:59:59.000Z')
  // Erinnerung ohne Frist geht nicht
  await submitForm(page, form, { inviteOnly: 'on', rsvpDeadline: '', rsvpReminderDays: '3' })
  expect((await stored()).rsvpReminderDays).toBe(7)
  // Ohne das Feld (z. B. ältere Formulare) bleibt der Modus
  const saved = await readForm(page, 'form:has(input[name="inviteOnly"])')
  await submitForm(page, { ...saved, fields: saved.fields.filter(([name]) => name !== 'inviteOnlyShown' && name !== 'inviteOnly') })
  expect((await stored()).inviteOnly).toBe(true)
})

test('Verwaltung: Einladungen per Textfeld anlegen, ändern, löschen; nur mit Zugriff', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await inviteEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/einladungen/${event.id}`)

  // Ungültige Zeile: Meldung, nichts angelegt
  await page.getByLabel('Neue Einladungen, eine Zeile pro Haushalt').fill('Familie Müller; mueller@example.org; Anna, Ben\nOma; oma@kaputt')
  await page.getByRole('button', { name: 'Einladungen anlegen' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'keine gültige E-Mail' })).toBeVisible()
  expect(await prisma.invitation.count({ where: { eventId: event.id } })).toBe(0)

  await page.getByLabel('Neue Einladungen, eine Zeile pro Haushalt').fill('Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind); +1\nTante Erna')
  await page.getByRole('button', { name: 'Einladungen anlegen' }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 Einladung(en) angelegt' })).toBeVisible()
  const invitations = await prisma.invitation.findMany({ where: { eventId: event.id }, include: { persons: { orderBy: { position: 'asc' } }, participant: true }, orderBy: { createdAt: 'asc' } })
  expect(invitations.map(i => [i.label, i.email, i.extraPersons, i.persons.map(p => `${p.name}/${p.ageGroup}`)])).toEqual([
    ['Familie Müller', 'mueller@example.org', 1, ['Anna/ADULT', 'Ben/ADULT', 'Clara/CHILD']],
    ['Tante Erna', null, 0, ['Tante Erna/ADULT']]
  ])
  await page.reload()
  await expect(page.getByTestId('invitation-summary')).toContainText('2 Haushalte (2 ohne Antwort)')
  await expect(page.getByLabel('Link für Familie Müller')).toHaveValue(`${BASE_URL}/${event.slug}?token=${invitations[0].participant.editToken}`)

  // Ändern: Ben heißt Benno, Clara fällt weg - der Link bleibt
  const card = page.getByTestId('invitation').filter({ hasText: 'Familie Müller' })
  await card.getByText('Bearbeiten').click()
  await card.getByLabel('Personen (mit Komma getrennt)').fill('Anna, Benno')
  await card.getByRole('button', { name: 'Speichern' }).click()
  await expect(card.getByRole('status')).toContainText('Gespeichert')
  const changed = await prisma.invitation.findUniqueOrThrow({ where: { id: invitations[0].id }, include: { persons: { orderBy: { position: 'asc' } }, participant: true } })
  expect(changed.persons.map(p => p.name)).toEqual(['Anna', 'Benno'])
  expect(changed.persons[1].id).toBe(invitations[0].persons[1].id)
  expect(changed.participant.editToken).toBe(invitations[0].participant.editToken)

  // Druckliste mit QR-Code je Haushalt
  await page.goto(`/admin/einladungen/${event.id}/druck`)
  await expect(page.getByTestId('invitation-card')).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'QR-Code für Tante Erna' })).toBeVisible()

  // Fremdes Konto: keine Seite, Aktionen wirken nicht (Positivkontrolle: Owner löscht danach)
  const stranger = await createAccount('CREATOR')
  const strangerPage = await newPage(browser)
  await login(strangerPage, stranger.email)
  expect((await strangerPage.goto(`/admin/einladungen/${event.id}`))!.status()).toBe(404)
  expect((await strangerPage.goto(`/admin/einladungen/${event.id}/druck`))!.status()).toBe(404)

  await page.goto(`/admin/einladungen/${event.id}`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Einladung Tante Erna löschen' }).click()
  await expect(page.getByTestId('invitation')).toHaveCount(1)
  expect(await prisma.participant.count({ where: { id: invitations[1].participantId } })).toBe(0)
})

test('Haushalt antwortet pro Person über seinen Link; ohne Link nur der Titel', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await inviteEvent(owner, { maxCapacity: 10, isGuestListVisible: true })
  const family = await invite(event, 'Familie Müller', [{ name: 'Anna' }, { name: 'Ben' }, { name: 'Clara', ageGroup: 'CHILD' }], { extraPersons: 1 })
  const other = await createEvent(owner)
  const { participant: foreign } = await createRsvp(other)

  // Ohne Link, mit fremdem oder erfundenem Link: nur Titel, weder Beschreibung noch Formular
  const visitor = await newPage(browser)
  for (const query of ['', `?token=${foreign.editToken}`, `?token=${randomUUID()}`]) {
    await visitor.goto(`/${event.slug}${query}`)
    await expect(visitor.getByTestId('invitation-gate')).toBeVisible()
    await expect(visitor.getByText(event.title)).toBeVisible()
    await expect(visitor.getByLabel('Dein Name')).toHaveCount(0)
    expect(await visitor.content()).not.toContain('Geheime Beschreibung')
  }
  // Kalenderdatei nur mit Antwort zu diesem Termin
  expect((await visitor.request.get(`/api/ical/${event.id}`)).status()).toBe(403)

  const guest = await newPage(browser)
  await guest.goto(`/${event.slug}?token=${family.participant.editToken}`)
  await expect(guest.getByText('💌 Einladung für Familie Müller')).toBeVisible()
  await attending(guest, 'Anna', 'kommt')
  await guest.locator('select[name="person_0_diet"]').selectOption('Vegan')
  await guest.locator('#person_1_name').fill('Benjamin')
  await attending(guest, 'Ben', 'kommt nicht')
  await attending(guest, 'Clara', 'kommt')
  await guest.getByRole('button', { name: '+ Weitere Person (0/1)' }).click()
  await guest.getByLabel('Weitere Person', { exact: true }).fill('Max')
  await expect(guest.getByRole('button', { name: /\+ Weitere Person/ })).toHaveCount(0)
  const captured = guest.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'] && (r.postData() ?? '').includes('householdShown'))
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()

  const answer = () => prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id }, include: { participant: true, persons: { orderBy: { position: 'asc' } } } })
  const saved = await answer()
  expect(saved).toMatchObject({ isAttending: true, isOnWaitlist: false, participant: { name: 'Familie Müller' } })
  expect(saved.persons.map(p => [p.name, p.ageGroup, p.isAttending, p.dietaryOption, p.invitationPersonId])).toEqual([
    ['Anna', 'ADULT', true, 'Vegan', family.persons[0].id],
    ['Benjamin', 'ADULT', false, null, family.persons[1].id],
    ['Clara', 'CHILD', true, null, family.persons[2].id],
    ['Max', 'ADULT', true, null, null]
  ])

  // Verwaltung: Stand pro Person, Gästeliste mit allen Personen
  await login(page, owner.email)
  await page.goto(`/admin/einladungen/${event.id}`)
  await expect(page.getByTestId('invitation')).toContainText('✓ Anna · ✗ Benjamin · ✓ Clara (Kind) · ✓ Max +')
  await expect(page.getByTestId('invitation-summary')).toContainText('3 kommen (2 Erwachsene, 1 Kinder, 0 Kleinkinder), 1 kommen nicht, 0 offen')
  await page.goto(`/admin/events/${event.id}/gaeste`)
  await expect(page.getByTestId('guest-persons')).toHaveText('✓ Anna (Vegan); ✗ Benjamin; ✓ Clara (Kind); ✓ Max')

  // Gästeliste für Eingeladene: Haushalt mit den Namen der Kommenden
  await guest.goto(`/${event.slug}?token=${family.participant.editToken}`)
  await expect(guest.getByText('(Anna, Clara, Max)')).toBeVisible()

  // Abgespielte Anfrage mit Änderungen: wirkt nur, solange sie zur Einladung passt
  const request: Request = await captured
  const cookies = await cookieHeader(guest.context())
  const replay = (body: string) => guest.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL, ...cookies },
    data: body
  })
  const original = request.postDataBuffer()!.toString('utf8')
  const otherFamily = await invite(event, 'Familie Schmidt', [{ name: 'Sara' }])
  // Person einer anderen Einladung untergeschoben
  expect(await (await replay(original.replaceAll(family.persons[1].id, otherFamily.persons[0].id))).text()).toContain('nicht zu dieser Einladung')
  // Link eines anderen Termins oder einer anderen Einladung: kein Zugriff auf diese Einladung
  expect(await (await replay(original.replaceAll(family.participant.editToken, foreign.editToken))).text()).toContain('persönliche Einladung')
  // Mehr Zusatzpersonen als erlaubt
  await prisma.invitation.update({ where: { id: family.id }, data: { extraPersons: 0 } })
  expect(await (await replay(original)).text()).toContain('keine weiteren Personen')
  expect((await answer()).persons).toHaveLength(4)
  // Positivkontrolle: wieder erlaubt, unveränderte Anfrage wirkt
  await prisma.invitation.update({ where: { id: family.id }, data: { extraPersons: 1 } })
  await prisma.rsvpPerson.updateMany({ where: { rsvpId: saved.id, name: 'Max' }, data: { name: 'Vorher' } })
  expect((await replay(original)).ok()).toBe(true)
  expect((await answer()).persons.map(p => p.name)).toContain('Max')
  expect(await prisma.rsvp.count({ where: { participantId: otherFamily.participantId } })).toBe(0)

  // Alle sagen ab: Absage des Haushalts
  await guest.goto(`/${event.slug}?token=${family.participant.editToken}`)
  await attending(guest, 'Anna', 'kommt nicht')
  await attending(guest, 'Clara', 'kommt nicht')
  await guest.getByRole('button', { name: 'Weitere Person 1 entfernen' }).click()
  await guest.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(guest.getByText('Schade, dass du nicht dabei bist!')).toBeVisible()
  expect((await answer()).isAttending).toBe(false)

  // Der tägliche Aufräumlauf lässt eingeladene Haushalte ohne Antwort stehen
  expect((await page.request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).ok()).toBe(true)
  expect(await prisma.invitation.count({ where: { id: otherFamily.id } })).toBe(1)
  expect(await prisma.participant.count({ where: { id: otherFamily.participantId } })).toBe(1)

  // Haushalt löscht seine Daten: Einladung geht mit
  await guest.goto(`/${event.slug}?token=${family.participant.editToken}`)
  guest.once('dialog', dialog => dialog.accept())
  await guest.getByRole('button', { name: /Daten.*löschen/ }).click()
  await expect.poll(() => prisma.invitation.count({ where: { id: family.id } })).toBe(0)
})

test('Plätze im Einladungsmodus: Haushalt als Ganzes, Kleinkinder ohne Platz; Löschen lässt nachrücken', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await inviteEvent(owner, { maxCapacity: 3 })
  const a = await invite(event, 'Familie A', [{ name: 'Anna' }, { name: 'Alex' }, { name: 'Mia', ageGroup: 'INFANT' }])
  const b = await invite(event, 'Familie B', [{ name: 'Bea' }, { name: 'Bob' }])

  const answerAll = async (token: string, names: string[]) => {
    const guest = await newPage(browser)
    await guest.goto(`/${event.slug}?token=${token}`)
    for (const name of names) await attending(guest, name, 'kommt')
    await guest.getByRole('button', { name: 'Antwort absenden' }).click()
    return guest
  }
  // A: 2 Plätze (Kleinkind zählt nicht), B: 2 Plätze - nur noch 1 frei -> Warteliste
  await expect((await answerAll(a.participant.editToken, ['Anna', 'Alex', 'Mia'])).getByText('Danke für deine Anmeldung!')).toBeVisible()
  await expect((await answerAll(b.participant.editToken, ['Bea', 'Bob'])).getByText('Du stehst auf der Warteliste!')).toBeVisible()

  // Nur ein Kleinkind zusagen geht nicht
  const c = await invite(event, 'Familie C', [{ name: 'Carl' }, { name: 'Cleo', ageGroup: 'INFANT' }])
  const guest = await newPage(browser)
  await guest.goto(`/${event.slug}?token=${c.participant.editToken}`)
  await attending(guest, 'Carl', 'kommt nicht')
  await attending(guest, 'Cleo', 'kommt')
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.locator('form p[role="alert"]')).toContainText('Kleinkinder können nur zusammen')
  expect(await prisma.rsvp.count({ where: { participantId: c.participantId } })).toBe(0)

  // Verwaltung löscht Einladung A: B rückt nach
  await login(page, owner.email)
  await page.goto(`/admin/einladungen/${event.id}`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Einladung Familie A löschen' }).click()
  await expect.poll(async () => (await prisma.rsvp.findFirstOrThrow({ where: { participantId: b.participantId } })).isOnWaitlist).toBe(false)
  expect(await prisma.rsvp.count({ where: { participantId: a.participantId } })).toBe(0)

  // Bearbeiten der Haushalts-Antwort in der Verwaltung ändert keine Personen
  const bRsvp = await prisma.rsvp.findFirstOrThrow({ where: { participantId: b.participantId } })
  await page.goto(`/admin/edit-rsvp/${bRsvp.id}`)
  await expect(page.getByTestId('household-note')).toContainText('Familie B')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(`**/admin/events/${event.id}/gaeste`)
  expect((await prisma.rsvpPerson.findMany({ where: { rsvpId: bRsvp.id }, orderBy: { position: 'asc' } })).map(p => [p.name, p.isAttending])).toEqual([['Bea', true], ['Bob', true]])
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: bRsvp.id } })).isAttending).toBe(true)
})

test('Antwortfrist: Hinweis vorher, danach nur lesen; Server lehnt ab', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const open = await createEvent(owner, { formConfig: FORM, rsvpDeadline: new Date(Date.now() + 5 * DAY) })
  const closed = await createEvent(owner, { formConfig: FORM, rsvpDeadline: new Date(Date.now() - DAY) })
  const { participant } = await createRsvp(closed, { name: 'Erika' })

  const guest = await newPage(browser)
  await guest.goto(`/${open.slug}`)
  await expect(guest.getByTestId('deadline')).toContainText('Bitte antworte bis')
  await guest.getByLabel('Dein Name').fill('Vorher')
  await guest.locator('input[name="isAttending"][value="true"]').check()
  await guest.locator('#dietaryOption').selectOption('Vegan')
  const captured = guest.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'])
  await guest.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(guest.getByText('Danke für deine Anmeldung!')).toBeVisible()

  await guest.goto(`/${closed.slug}?token=${participant.editToken}`)
  await expect(guest.getByTestId('deadline')).toContainText('abgelaufen')
  await expect(guest.getByRole('button', { name: /Änderungen speichern|Antwort absenden/ })).toHaveCount(0)
  await expect(guest.getByLabel('Dein Name')).toBeDisabled()

  // Abgespielt auf den abgelaufenen Termin: abgelehnt (Positivkontrolle: derselbe Weg ging oben)
  const request = await captured
  const response = await guest.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL },
    data: await withFreshPow(guest, request.postDataBuffer()!.toString('utf8').replaceAll(open.id, closed.id).replace('Vorher', 'Nachher'))
  })
  expect(await response.text()).toContain('Antwortfrist')
  expect(await prisma.participant.count({ where: { name: 'Nachher' } })).toBe(0)
})

test('Erinnerung an Einladungen ohne Antwort: per Cron einmal vor der Frist, per Knopf nur für Owner', async ({ page, browser, request }) => {
  const owner = await createAccount('CREATOR')
  const event = await inviteEvent(owner, { rsvpDeadline: new Date(Date.now() + 5 * DAY), rsvpReminderDays: 7 })
  const silent = await invite(event, 'Stille Familie', [{ name: 'Sam' }], { email: 'still@example.test' })
  const answered = await invite(event, 'Antwortende', [{ name: 'Ari' }], { email: 'ari@example.test' })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: answered.participantId, isAttending: true } })
  const noMail = await invite(event, 'Ohne Mail', [{ name: 'Olli' }])
  // Zu früh: Frist in 30 Tagen, Erinnerung 7 Tage vorher
  const later = await inviteEvent(owner, { rsvpDeadline: new Date(Date.now() + 30 * DAY), rsvpReminderDays: 7 })
  const early = await invite(later, 'Zu früh', [{ name: 'Zoe' }], { email: 'zoe@example.test' })

  const cron = async () => (await (await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)).json()).invitationReminders
  expect(await cron()).toBeGreaterThanOrEqual(1)
  // Pro Einladung und Termin (InvitationReminder)
  const reminded = (id: string) => prisma.invitationReminder.findFirst({ where: { invitationId: id } }).then(r => r?.sentAt ?? null)
  expect(await reminded(silent.id)).not.toBeNull()
  expect(await reminded(answered.id)).toBeNull()
  expect(await reminded(noMail.id)).toBeNull()
  expect(await reminded(early.id)).toBeNull()
  const first = await reminded(silent.id)
  await cron()
  expect(await reminded(silent.id)).toEqual(first)

  // Knopf: Moderator*in sieht ihn nicht und die Aktion wirkt nicht; Owner schon
  const moderator = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: event.id } })
  const modPage = await newPage(browser)
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/einladungen/${event.id}`)
  await expect(modPage.getByRole('button', { name: /Erinnerung an/ })).toHaveCount(0)
  await expect(modPage.getByRole('button', { name: /Einladungen per Mail senden/ })).toHaveCount(0)

  await login(page, owner.email)
  await page.goto(`/admin/einladungen/${event.id}`)
  const form = await readForm(page, 'form:has(button:has-text("Erinnerung an"))')
  await submitForm(modPage, { ...form, url: form.url })
  expect(await reminded(silent.id)).toEqual(first)
  await page.getByRole('button', { name: 'Erinnerung an 1 ohne Antwort senden' }).click()
  await expect(page.getByRole('status')).toContainText('1 Erinnerung(en) verschickt')
  expect((await reminded(silent.id))!.getTime()).toBeGreaterThan(first!.getTime())

  // Einladungsmail: ohne Mailserver schlägt der Versand fehl, die Einladung bleibt "nicht gesendet"
  await page.getByRole('button', { name: /Einladungen per Mail senden \(2 noch nicht gesendet\)/ }).click()
  await expect(page.getByRole('status')).toContainText('0 Einladung(en) per Mail verschickt')
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: silent.id } })).sentAt).toBeNull()
})
