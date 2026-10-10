import { randomBytes } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Event, User } from '@prisma/client'
import {
  BASE_URL, TEST_SEATING_BASE_URL, TEST_SEATING_SECRET, cookieHeader, createAccount, createApiToken, createEvent, createGuestUser,
  createRsvp, createSeries, createTermin, decodeCouplingToken, linkTool, locationOf, login, prisma, readForm, signCouplingToken, submitForm
} from './helpers'

// Tickets und Bezahlung (docs/KONZEPT-TICKETS.md, app/lib/tickets.ts, app/lib/payment.ts, app/lib/waitlist.ts):
// Kategorien mit Preis und Kontingent im Termin-Formular, Auswahl und Warteliste je Kategorie, Zahlungsdaten
// für Gäste, Bezahlstatus in der Verwaltung (auch Moderator*innen), Stornieren nach Frist, Abendkasse beim
// Einlass, Sitzplatzwahl erst nach Zahlung, CSV und Client-API.

const IBAN = 'DE89370400440532013000'
const PAYMENT = { paymentRecipient: 'Fachschaft Musterfach', paymentIban: IBAN }
const DAY = 24 * 60 * 60 * 1000

async function ticketEvent(owner: User, categories: { label: string; priceCents?: number; capacity?: number | null }[], data: Partial<Event> = {}) {
  const event = await createEvent(owner, { ...PAYMENT, ...data })
  const created = []
  for (const [position, c] of categories.entries()) {
    created.push(await prisma.ticketCategory.create({ data: { eventId: event.id, label: c.label, priceCents: c.priceCents ?? 0, capacity: c.capacity ?? null, position } }))
  }
  return { event, categories: created }
}

/** Antwortet über das Gästeformular mit einer Kategorie. */
async function answer(page: Page, slug: string, name: string, category: string | null, query = '') {
  await page.goto(`/${slug}${query}`)
  await page.getByLabel('Dein Name').fill(name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  if (category) await page.getByRole('radio', { name: new RegExp(`^${category}`) }).check()
  await page.getByRole('button', { name: /Antwort absenden|Änderungen speichern/ }).click()
}

async function newGuest(browser: Browser) {
  return (await browser.newContext()).newPage()
}

const rsvpOf = (eventId: string, name: string) =>
  prisma.rsvp.findFirstOrThrow({ where: { eventId, participant: { name } }, include: { participant: true } })

test('Kategorien und Konto im Termin-Formular; Fehler ändern nichts; Kategorie mit Antworten bleibt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = await readForm(page, 'form:has(textarea[name="ticketCategories"])')

  await submitForm(page, form, { ticketCategories: 'Studierende; 25; 120\nGäste; 35,50', paymentRecipient: 'Fachschaft Musterfach', paymentIban: 'de89 3704 0044 0532 0130 00', paymentDueDays: '14' })
  const categories = () => prisma.ticketCategory.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } })
  expect((await categories()).map(c => [c.label, c.priceCents, c.capacity])).toEqual([['Studierende', 2500, 120], ['Gäste', 3550, null]])
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ paymentRecipient: 'Fachschaft Musterfach', paymentIban: IBAN, paymentDueDays: 14 })
  // Ab hier mit dem gespeicherten Stand (Konto ausgefüllt), damit jede Ablehnung nur den geprüften Grund hat
  const saved = await readForm(page, 'form:has(textarea[name="ticketCategories"])')

  // Preis ohne Konto, ungültige IBAN: nichts ändert sich (auch nicht die übrigen Felder)
  await submitForm(page, saved, { ticketCategories: 'Studierende; 30', paymentRecipient: '', paymentIban: '', title: 'Geändert' })
  await submitForm(page, saved, { ticketCategories: 'Studierende; 30', paymentIban: 'DE89 3704 0044 0532 0130 01', title: 'Geändert' })
  expect((await categories()).map(c => c.priceCents)).toEqual([2500, 3550])
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe(event.title)

  // Kategorie mit Antwort lässt sich nicht entfernen (und das Event wird nicht halb gespeichert)
  const { rsvp } = await createRsvp(event)
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { ticketCategoryId: (await categories())[1].id } })
  await submitForm(page, saved, { ticketCategories: 'Studierende; 25; 120', title: 'Geändert' })
  expect((await categories()).length).toBe(2)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe(event.title)

  // Positivkontrolle: neue Preise speichern, bestehende Antwort behält ihre Kategorie
  await submitForm(page, saved, { ticketCategories: 'Studierende; 27; 120\nGäste; 36\nHelfer*innen; 0; 5' })
  expect((await categories()).map(c => [c.label, c.priceCents])).toEqual([['Studierende', 2700], ['Gäste', 3600], ['Helfer*innen', 0]])
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })).ticketCategoryId).toBe((await categories())[1].id)
  await page.reload()
  await expect(page.locator('textarea[name="ticketCategories"]')).toHaveValue('Studierende; 27; 120\nGäste; 36\nHelfer*innen; 0; 5')
  await expect(page.locator('input[name="paymentIban"]')).toHaveValue('DE89 3704 0044 0532 0130 00')
})

test('Gäste wählen eine Kategorie; Kontingent je Kategorie, Warteliste und Nachrücken; Zahlungsdaten', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const { event } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500, capacity: 1 }, { label: 'Gäste', priceCents: 3550 }], {
    formConfig: JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: false, askPlusOne: true })
  })

  const anna = await newGuest(browser)
  await anna.goto(`/${event.slug}`)
  await anna.locator('input[name="isAttending"][value="true"]').check()
  // Bei Kategorien keine Begleitung
  await expect(anna.getByText('Bringst du eine Begleitperson mit?')).toHaveCount(0)
  await expect(anna.getByText('(noch 1 frei)')).toBeVisible()
  await answer(anna, event.slug, 'Anna', 'Studierende')
  await expect(anna.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const box = anna.getByTestId('payment-box')
  await expect(box).toContainText('25,00 €')
  await expect(box).toContainText('DE89 3704 0044 0532 0130 00')
  await expect(box.getByRole('img', { name: 'GiroCode für die Überweisung' })).toBeVisible()
  const annaRsvp = await rsvpOf(event.id, 'Anna')
  expect(annaRsvp).toMatchObject({ amountCents: 2500, isOnWaitlist: false, plusOne: false })
  expect(annaRsvp.paymentReference).toMatch(/^E2E[A-Z0-9]{0,5}-[A-Z0-9]{8}$/)
  await expect(box.getByTestId('payment-reference')).toHaveText(annaRsvp.paymentReference!)

  // Studierende voll: Warteliste dieser Kategorie, ohne Zahlungsdaten
  const ben = await newGuest(browser)
  await ben.goto(`/${event.slug}`)
  await ben.locator('input[name="isAttending"][value="true"]').check()
  await expect(ben.getByText('(ausgebucht - Warteliste)')).toBeVisible()
  await answer(ben, event.slug, 'Ben', 'Studierende')
  await expect(ben.getByText('Du stehst auf der Warteliste!')).toBeVisible()
  expect(await rsvpOf(event.id, 'Ben')).toMatchObject({ isOnWaitlist: true, amountCents: 2500, paymentDueAt: null })

  // Die andere Kategorie ist nicht blockiert
  const cem = await newGuest(browser)
  await answer(cem, event.slug, 'Cem', 'Gäste')
  await expect(cem.getByText('Danke für deine Anmeldung!')).toBeVisible()
  expect(await rsvpOf(event.id, 'Cem')).toMatchObject({ isOnWaitlist: false, amountCents: 3550 })

  // Anna sagt ab: Ben rückt nach und muss jetzt zahlen
  await anna.goto(`/${event.slug}?token=${annaRsvp.participant.editToken}`)
  await expect(anna.getByTestId('payment-box')).toContainText('25,00 €')
  await anna.locator('input[name="isAttending"][value="false"]').check()
  await anna.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(anna.getByText('Deine Absage wurde erfolgreich gespeichert.')).toBeVisible()
  const benRsvp = await rsvpOf(event.id, 'Ben')
  expect(benRsvp.isOnWaitlist).toBe(false)
  await ben.goto(`/${event.slug}?token=${benRsvp.participant.editToken}`)
  await expect(ben.getByTestId('payment-box')).toContainText(benRsvp.paymentReference!)
})

test('Manipulierte Kategorie, Wechsel in eine volle Kategorie, Wechsel nach der Zahlung', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud, gast] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500, capacity: 1 }, { label: 'Gäste', priceCents: 3500, capacity: 1 }])
  const { categories: [foreign] } = await ticketEvent(owner, [{ label: 'Fremd', priceCents: 1 }])

  // Kategorie eines ANDEREN Termins (DOM manipuliert): abgelehnt, nichts angelegt
  const eve = await newGuest(browser)
  await eve.goto(`/${event.slug}`)
  await eve.getByLabel('Dein Name').fill('Eve')
  await eve.locator('input[name="isAttending"][value="true"]').check()
  await eve.locator('input[name="ticketCategoryId"]').first().evaluate((el, id) => { (el as HTMLInputElement).value = id; (el as HTMLInputElement).checked = true }, foreign.id)
  await eve.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(eve.getByRole('alert').filter({ hasText: 'Bitte wähle eine Ticketkategorie.' })).toBeVisible()
  expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(0)

  // Positivkontrolle und Belegung: Gäste ist mit Gina voll
  const gina = await newGuest(browser)
  await answer(gina, event.slug, 'Gina', 'Gäste')
  await expect(gina.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const sam = await newGuest(browser)
  await answer(sam, event.slug, 'Sam', 'Studierende')
  await expect(sam.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const samRsvp = await rsvpOf(event.id, 'Sam')

  // Sam will in die volle Kategorie "Gäste" (am gesperrten Hinweis vorbei): abgelehnt, Platz bleibt
  await answer(sam, event.slug, 'Sam', 'Gäste', `?token=${samRsvp.participant.editToken}`)
  await expect(sam.getByRole('alert').filter({ hasText: 'ist ausgebucht' })).toBeVisible()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: samRsvp.id } })).toMatchObject({ ticketCategoryId: stud.id, isOnWaitlist: false, amountCents: 2500 })

  // Vor der Zahlung darf Sam wechseln, sobald Platz ist - der Betrag folgt der Kategorie
  await prisma.ticketCategory.update({ where: { id: gast.id }, data: { capacity: 2 } })
  await answer(sam, event.slug, 'Sam', 'Gäste', `?token=${samRsvp.participant.editToken}`)
  await expect(sam.getByText('Danke für deine Anmeldung!')).toBeVisible()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: samRsvp.id } })).toMatchObject({ ticketCategoryId: gast.id, amountCents: 3500, paymentReference: samRsvp.paymentReference })

  // Nach der Zahlung nicht mehr (DOM entsperrt): abgelehnt
  await prisma.rsvp.update({ where: { id: samRsvp.id }, data: { paidAt: new Date(), paymentMethod: 'TRANSFER' } })
  await sam.goto(`/${event.slug}?token=${samRsvp.participant.editToken}`)
  await sam.locator('input[name="isAttending"][value="true"]').check()
  await expect(sam.getByRole('radio', { name: /^Studierende/ })).toBeDisabled()
  await sam.locator('input[name="ticketCategoryId"]').evaluateAll(inputs => inputs.forEach(i => { (i as HTMLInputElement).disabled = false }))
  await sam.getByRole('radio', { name: /^Studierende/ }).check()
  await sam.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(sam.getByRole('alert').filter({ hasText: 'Nach der Zahlung' })).toBeVisible()
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: samRsvp.id } })).ticketCategoryId).toBe(gast.id)
})

test('Bezahlstatus: Owner und freigegebene Moderator*innen ja, andere nicht; Erstattung', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500 }])
  const { rsvp } = await createRsvp(event, { name: 'Zahlende' })
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { ticketCategoryId: stud.id, amountCents: 2500, paymentReference: 'E2E-' + randomBytes(4).toString('hex').toUpperCase() } })

  await login(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByTestId('ticket-summary')).toContainText('offen 25,00 €')
  const markPaid = await readForm(page, 'form:has(input[name="paymentAction"][value="paid-transfer"])')
  const paymentOf = () => prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })

  // Moderator*in ohne Freigabe: nichts passiert
  const stranger = await createAccount('MODERATOR')
  const strangerPage = await (await browser.newContext()).newPage()
  await login(strangerPage, stranger.email)
  await submitForm(strangerPage, markPaid)
  expect((await paymentOf()).paidAt).toBeNull()

  // Positivkontrolle: mit Freigabe für dieses Event (Abendkasse)
  const helper = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: helper.id, eventId: event.id } })
  const helperPage = await (await browser.newContext()).newPage()
  await login(helperPage, helper.email)
  await submitForm(helperPage, markPaid)
  const paid = await paymentOf()
  expect(paid.paidAt).not.toBeNull()
  expect(paid.paymentMethod).toBe('TRANSFER')
  // Doppelklick: bleibt bei der ersten Zahlung
  await submitForm(helperPage, markPaid, { paymentAction: 'paid-cash' })
  expect(await paymentOf()).toMatchObject({ paidAt: paid.paidAt, paymentMethod: 'TRANSFER' })

  // "erstattet" geht nur nach einer Absage
  await submitForm(page, markPaid, { paymentAction: 'refunded' })
  expect((await paymentOf()).refundedAt).toBeNull()
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { isAttending: false } })
  await submitForm(page, markPaid, { paymentAction: 'refunded' })
  expect((await paymentOf()).refundedAt).not.toBeNull()
  await page.goto('/admin')
  await expect(page.getByTestId('payment-cell')).toContainText('Erstattet')

  // Zurücksetzen nur bei "bezahlt" (nicht erstattet)
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { isAttending: true, refundedAt: null } })
  await submitForm(page, markPaid, { paymentAction: 'unpaid' })
  expect(await paymentOf()).toMatchObject({ paidAt: null, paymentMethod: null })
})

test('Zahlfrist: überfällig markiert, Stornieren nur bei überfällig, Warteliste rückt nach', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500, capacity: 2 }], { paymentDueDays: 7 })
  const ticket = { ticketCategoryId: stud.id, amountCents: 2500 }
  const late = await createRsvp(event, { name: 'Spät' })
  await prisma.rsvp.update({ where: { id: late.rsvp.id }, data: { ...ticket, paymentReference: 'E2E-LATE' + randomBytes(3).toString('hex'), paymentDueAt: new Date(Date.now() - DAY) } })
  const onTime = await createRsvp(event, { name: 'Pünktlich' })
  await prisma.rsvp.update({ where: { id: onTime.rsvp.id }, data: { ...ticket, paymentReference: 'E2E-OK' + randomBytes(3).toString('hex'), paymentDueAt: new Date(Date.now() + DAY) } })
  const waiting = await createRsvp(event, { name: 'Wartend', isOnWaitlist: true })
  await prisma.rsvp.update({ where: { id: waiting.rsvp.id }, data: ticket })

  await login(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByTestId('ticket-summary')).toContainText('1 überfällig')
  const cancel = await readForm(page, 'form:has(button:has-text("Stornieren"))')

  // Nicht überfällig: Stornieren wirkt nicht
  await submitForm(page, cancel, { rsvpId: onTime.rsvp.id })
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: onTime.rsvp.id } })).isAttending).toBe(true)

  // Positivkontrolle: überfällig -> Absage ohne öffentlichen Grund, Wartende rückt nach und bekommt eine Frist
  await submitForm(page, cancel)
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: late.rsvp.id } })).toMatchObject({ isAttending: false, declineReason: null })
  const promoted = await prisma.rsvp.findUniqueOrThrow({ where: { id: waiting.rsvp.id } })
  expect(promoted.isOnWaitlist).toBe(false)
  expect(promoted.paymentDueAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
  expect(promoted.paymentReference).toMatch(/^E2E/)

  // Erneute Zusage über den persönlichen Link: neue Frist statt sofort wieder überfällig
  const again = await page.context().browser()!.newPage()
  await answer(again, event.slug, 'Spät', 'Studierende', `?token=${late.participant.editToken}`)
  await expect(again.getByText(/Warteliste|Danke für deine Anmeldung/).first()).toBeVisible()
  await prisma.ticketCategory.update({ where: { id: stud.id }, data: { capacity: 3 } })
  await answer(again, event.slug, 'Spät', 'Studierende', `?token=${late.participant.editToken}`)
  await expect(again.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const back = await prisma.rsvp.findUniqueOrThrow({ where: { id: late.rsvp.id } })
  expect(back.isOnWaitlist).toBe(false)
  expect(back.paymentDueAt!.getTime()).toBeGreaterThan(Date.now())
})

test('Einlass: offene Zahlung checkt nicht automatisch ein, Abendkasse kassiert bar', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500 }], { enableCheckin: true })
  const unpaid = await createRsvp(event, { name: 'Abendkasse' })
  await prisma.rsvp.update({ where: { id: unpaid.rsvp.id }, data: { ticketCategoryId: stud.id, amountCents: 2500, paymentReference: 'E2E-DOOR' + randomBytes(3).toString('hex') } })
  const paid = await createRsvp(event, { name: 'Vorab' })
  await prisma.rsvp.update({ where: { id: paid.rsvp.id }, data: { ticketCategoryId: stud.id, amountCents: 2500, paidAt: new Date(), paymentMethod: 'TRANSFER' } })

  await login(page, owner.email)
  await page.goto(`/admin/checkin/${paid.rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  await expect(page.getByTestId('checkin-ticket')).toContainText('Studierende')

  await page.goto(`/admin/checkin/${unpaid.rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Offen: 25,00 €' })).toBeVisible()
  expect((await prisma.rsvp.findUniqueOrThrow({ where: { id: unpaid.rsvp.id } })).hasAttended).toBe(false)
  await page.getByRole('button', { name: '💶 Bar kassiert - einlassen' }).click()
  await expect(page.getByRole('heading', { name: 'Bereits eingecheckt' })).toBeVisible()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: unpaid.rsvp.id } })).toMatchObject({ hasAttended: true, paymentMethod: 'CASH' })
  await expect(page.getByTestId('checkin-ticket')).toContainText('bar bezahlt')
})

test('Sitzplatzwahl erst nach Zahlung: Link, Gästeliste für Seating und Hinweis', async ({ page, request }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud, free] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2500 }, { label: 'Ehrengäste' }], { seatingRequiresPayment: true })
  const seatingEventId = 'cmseat' + randomBytes(10).toString('hex')
  await linkTool(event, 'seating', `${TEST_SEATING_BASE_URL}/rsvp/${seatingEventId}`)
  const unpaid = await createRsvp(event, { name: 'Unbezahlt' })
  await prisma.rsvp.update({ where: { id: unpaid.rsvp.id }, data: { ticketCategoryId: stud.id, amountCents: 2500, paymentReference: 'E2E-SEAT' + randomBytes(3).toString('hex') } })
  const guest = await createRsvp(event, { name: 'Ehrengast' })
  await prisma.rsvp.update({ where: { id: guest.rsvp.id }, data: { ticketCategoryId: free.id, amountCents: 0 } })

  const seatLink = (token: string) => request.get(`/api/seating-link/${event.id}?token=${token}`, { maxRedirects: 0 })
  expect(locationOf(await seatLink(unpaid.participant.editToken))!.origin).toBe(BASE_URL)
  // Kostenlose Kategorie: nichts zu zahlen, Sitzplatzwahl sofort
  expect(locationOf(await seatLink(guest.participant.editToken))!.origin).toBe(TEST_SEATING_BASE_URL)

  await page.goto(`/${event.slug}?token=${unpaid.participant.editToken}`)
  await expect(page.getByText('Deinen Sitzplatz kannst du wählen, sobald deine Zahlung eingegangen ist.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Sitzplatz wählen/ })).toHaveCount(0)

  const now = Math.floor(Date.now() / 1000)
  const guestList = async () => {
    const body = signCouplingToken({ typ: 'guest-list-request', aud: BASE_URL, iat: now, exp: now + 600, seatingEventId, rsvpEventId: event.id }, TEST_SEATING_SECRET)
    const response = await request.post('/api/seating/guest-list', { data: body, headers: { 'content-type': 'text/plain' } })
    return (decodeCouplingToken(await response.text()).guests as { rsvpId: string }[]).map(g => g.rsvpId)
  }
  expect(await guestList()).toEqual([guest.rsvp.id])

  // Positivkontrolle: bezahlt -> zählt bei Seating
  await prisma.rsvp.update({ where: { id: unpaid.rsvp.id }, data: { paidAt: new Date(), paymentMethod: 'TRANSFER' } })
  expect(locationOf(await seatLink(unpaid.participant.editToken))!.origin).toBe(TEST_SEATING_BASE_URL)
  expect((await guestList()).sort()).toEqual([guest.rsvp.id, unpaid.rsvp.id].sort())
  await page.reload()
  await expect(page.getByRole('link', { name: /Sitzplatz wählen/ })).toBeVisible()
})

test('CSV-Export mit Kategorie, Betrag und Zahlstatus', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const { event, categories: [stud] } = await ticketEvent(owner, [{ label: 'Studierende', priceCents: 2550 }])
  const { rsvp } = await createRsvp(event, { name: 'Csv' })
  await prisma.rsvp.update({ where: { id: rsvp.id }, data: { ticketCategoryId: stud.id, amountCents: 2550, paymentReference: 'E2E-CSV12345', paidAt: new Date('2026-10-01T10:00:00Z'), paymentMethod: 'CASH' } })
  await login(page, owner.email)
  const csv = await (await page.request.get(`/api/export?eventId=${event.id}`, { headers: await cookieHeader(page.context()) })).text()
  expect(csv).toContain(';Kategorie;Betrag;Verwendungszweck;Zahlstatus;Bezahlt am;Zahlart;Erstattet am')
  expect(csv).toContain('"Studierende";"25,50";"E2E-CSV12345";"Bezahlt";"2026-10-01";"Bar";""')
})

test('Client-API: Kategorie Pflicht bei Terminen mit Kategorien', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series, PAYMENT)
  const stud = await prisma.ticketCategory.create({ data: { eventId: termin.id, label: 'Studierende', priceCents: 2500, position: 0 } })
  const guestUser = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guestUser.id, seriesId: series.id } })
  const authorization = `Bearer ${await createApiToken(guestUser)}`
  const post = (data: object) => request.post(`/api/v1/termine/${termin.id}/antwort`, { data, headers: { authorization } })

  const missing = await post({ isAttending: true })
  expect(missing.status()).toBe(400)
  expect((await missing.json()).error).toContain('Ticketkategorie')

  const ok = await post({ isAttending: true, ticketCategoryId: stud.id })
  expect(ok.status()).toBe(200)
  const body = await ok.json()
  expect(body.payment).toMatchObject({ state: 'open', amount: expect.stringContaining('25,00') })
  expect(body.payment.transfer.reference).toMatch(/^TERMIN[A-Z0-9]{0,2}-/)
  // Ohne Feld gilt danach die bisherige Kategorie
  expect((await post({ isAttending: true })).status()).toBe(200)
})
