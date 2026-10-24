import { createHmac } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { BASE_URL, TEST_ABSTIMMUNGSTOOL_BASE_URL, TEST_CRON_SECRET, TEST_POLL_SECRET } from '../../playwright.config'
import {
  createAccount, createEvent, createGuestUser, createRsvp, createSeries, createTermin, decodeCouplingToken, GUEST_SESSION_COOKIE,
  locationOf, login, plantGuestSession, prisma, readForm, submitForm, unique, unlockPin
} from './helpers'

// Feedback-Fragebogen nach dem Event (Idee L8 Teil 2, app/lib/feedback-link.ts, app/lib/feedback.ts): Feld im
// Termin-Formular, "Feedback geben" auf der Event-Seite, Weiterleitung mit Nachweis (/api/feedback-link) und Versand
// durch den Erinnerungs-Cron. Jeder abgelehnte Fall hat eine positive Gegenprobe.

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000)
const surveyUrl = (id = `cm${unique().replace(/[^a-z0-9]/gi, '')}`) => `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/fragebogen/${id}`
const feedbackLink = (page: Page) => page.getByRole('link', { name: /Feedback geben/ })

const open = (request: APIRequestContext, eventId: string, token?: string, headers: Record<string, string> = {}) =>
  request.get(`/api/feedback-link/${eventId}${token ? `?token=${encodeURIComponent(token)}` : ''}`, { maxRedirects: 0, headers })

/** Ein vergangener Termin mit Fragebogen (Ende vor 2 Stunden). */
async function pastEvent(data: Parameters<typeof createEvent>[1] = {}) {
  const owner = await createAccount('CREATOR')
  const url = surveyUrl()
  const event = await createEvent(owner, { date: hoursAgo(6), duration: 4, feedbackUrl: url, ...data })
  return { owner, event, surveyId: new URL(url).pathname.split('/').pop()! }
}

test('Feld im Termin-Formular: nur Fragebögen des Abstimmungstools, Versand nur mit Link', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=verknuepfungen`)
  const form = () => readForm(page, '#event-settings-form')
  const stored = async () => prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { feedbackUrl: true, feedbackDelayHours: true } })

  const url = surveyUrl()
  await submitForm(page, await form(), { feedbackUrl: `${url}/`, feedbackDelayHours: '12' })
  expect(await stored()).toEqual({ feedbackUrl: url, feedbackDelayHours: 12 })
  await page.reload()
  await expect(page.locator('input[name="feedbackUrl"]')).toHaveValue(url)
  await expect(page.locator('select[name="feedbackDelayHours"]')).toHaveValue('12')

  // Fremde Adressen und andere Seiten des Abstimmungstools werden abgelehnt, der alte Stand bleibt
  for (const bad of ['https://fremd.example.test/fragebogen/abc', `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/abc`, 'javascript:alert(1)']) {
    await submitForm(page, await form(), { feedbackUrl: bad, feedbackDelayHours: '0' })
    expect(await stored(), bad).toEqual({ feedbackUrl: url, feedbackDelayHours: 12 })
  }
  // Unbekannte Verzögerung: nicht verschicken
  await submitForm(page, await form(), { feedbackUrl: url, feedbackDelayHours: '5' })
  expect(await stored()).toEqual({ feedbackUrl: url, feedbackDelayHours: null })
  // Ohne Link auch kein Versand
  await submitForm(page, await form(), { feedbackUrl: '', feedbackDelayHours: '24' })
  expect(await stored()).toEqual({ feedbackUrl: null, feedbackDelayHours: null })
})

test.describe('Feedback geben (/api/feedback-link)', () => {
  test('Zusage nach dem Ende: frischer Nachweis mit Pseudonym, 303 ohne Referer', async ({ request }) => {
    const { event, surveyId } = await pastEvent()
    const guest = await createRsvp(event)

    const ok = await open(request, event.id, guest.participant.editToken)
    expect(ok.status()).toBe(303)
    expect(ok.headers()['cache-control']).toContain('no-store')
    expect(ok.headers()['referrer-policy']).toBe('no-referrer')
    const target = locationOf(ok)!
    expect(`${target.origin}${target.pathname}`).toBe(`${TEST_ABSTIMMUNGSTOOL_BASE_URL}/fragebogen/${surveyId}`)
    const proof = target.searchParams.get('verify')!
    const [payloadPart, signature] = proof.split('.')
    expect(createHmac('sha256', TEST_POLL_SECRET).update(payloadPart).digest('base64url')).toBe(signature)
    const payload = decodeCouplingToken(proof)
    expect(payload).toEqual({ typ: 'survey-access', aud: TEST_ABSTIMMUNGSTOOL_BASE_URL, surveyId, sub: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), iat: expect.any(Number), exp: expect.any(Number) })
    expect((payload.exp as number) - Date.now() / 1000).toBeGreaterThan(11.9 * 3600)
    // Keine Kennung oder Daten der Person im Nachweis
    for (const value of [guest.rsvp.id, guest.participant.id, guest.participant.editToken, guest.participant.name]) expect(proof).not.toContain(value)

    // Derselbe Gast bekommt bei jedem Klick dasselbe Pseudonym (eine Antwort, änderbar), ein anderer ein anderes
    const again = decodeCouplingToken(locationOf(await open(request, event.id, guest.participant.editToken))!.searchParams.get('verify')!)
    expect(again.sub).toBe(payload.sub)
    const other = await createRsvp(event)
    const otherProof = decodeCouplingToken(locationOf(await open(request, event.id, other.participant.editToken))!.searchParams.get('verify')!)
    expect(otherProof.sub).not.toBe(payload.sub)
  })

  test('nicht vor dem Ende, nicht für Warteliste, Absage, fremde oder erfundene Tokens', async ({ request }) => {
    const { owner, event } = await pastEvent()
    const confirmed = await createRsvp(event)
    const running = await createEvent(owner, { date: hoursAgo(1), duration: 4, feedbackUrl: surveyUrl() })
    const runningGuest = await createRsvp(running)
    const { event: other } = await pastEvent()
    const foreign = await createRsvp(other)

    const backTo = async (eventId: string, token?: string) => locationOf(await open(request, eventId, token))!
    for (const [name, rsvp] of [['Warteliste', await createRsvp(event, { isOnWaitlist: true })], ['Absage', await createRsvp(event, { isAttending: false })]] as const) {
      const back = await backTo(event.id, rsvp.participant.editToken)
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.pathname, name).toBe(`/${event.slug}`)
      expect(back.searchParams.get('token'), name).toBe(rsvp.participant.editToken)
    }
    expect((await backTo(running.id, runningGuest.participant.editToken)).pathname).toBe(`/${running.slug}`)
    for (const [name, token] of [['fremd', foreign.participant.editToken], ['erfunden', 'kein-echter-token'], ['ohne', undefined]] as const) {
      const back = await backTo(event.id, token)
      expect(back.origin, name).toBe(BASE_URL)
      expect(back.pathname, name).toBe(`/${event.slug}`)
      expect(back.searchParams.has('token'), name).toBe(false)
    }
    // Gegenprobe
    expect((await backTo(event.id, confirmed.participant.editToken)).origin).toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)
  })

  test('mit QR-Einlass nur Eingecheckte', async ({ request }) => {
    const { event } = await pastEvent({ enableCheckin: true })
    const guest = await createRsvp(event)
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(BASE_URL)
    await prisma.rsvp.update({ where: { id: guest.rsvp.id }, data: { hasAttended: true, checkedInAt: new Date() } })
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)
  })

  test('Verifizierung, offenes Datum und fremde Fragebogen-Adresse', async ({ request }) => {
    const { owner, event } = await pastEvent({ requireVerification: true })
    const guest = await createRsvp(event)
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(BASE_URL)
    await prisma.participant.update({ where: { id: guest.participant.id }, data: { isVerified: true } })
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)

    await prisma.event.update({ where: { id: event.id }, data: { datePending: true } })
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(BASE_URL)

    // Direkt in die Datenbank geschriebene fremde Adresse: Die Route prüft bei jedem Aufruf und leitet nie dorthin
    const forged = await createEvent(owner, { date: hoursAgo(6), duration: 4, feedbackUrl: 'https://fremd.example.test/fragebogen/abc' })
    const forgedGuest = await createRsvp(forged)
    expect(locationOf(await open(request, forged.id, forgedGuest.participant.editToken))!.toString()).toBe(`${BASE_URL}/`)
  })

  test('PIN: ohne Token nur mit PIN-Cookie, Termin einer Reihe über die Gast-Sitzung', async ({ browser, request }) => {
    const { owner, event } = await pastEvent({ eventPin: '4711' })
    const guest = await createRsvp(event)
    // Der persönliche Link gehört nachweislich hierher und geht auch ohne PIN-Cookie
    expect(locationOf(await open(request, event.id, guest.participant.editToken))!.origin).toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)

    const series = await createSeries(owner)
    const termin = await createTermin(series, { date: hoursAgo(6), duration: 4, feedbackUrl: surveyUrl() })
    const account = await createGuestUser({ verified: true })
    const member = await createRsvp(termin, { guestUserId: account.id })
    const context = await browser.newContext()
    const page = await context.newPage()
    // Ohne Sitzung: zurück zum Termin
    let response = await page.request.get(`/api/feedback-link/${termin.id}`, { maxRedirects: 0 })
    expect(locationOf(response)!.pathname).toBe(`/reihe/${series.slug}/${termin.slug}`)
    // Mit Sitzung des Kontos, dem die Zusage gehört: weiter zum Fragebogen
    const session = await plantGuestSession(context, account)
    response = await page.request.get(`/api/feedback-link/${termin.id}`, { maxRedirects: 0, headers: { cookie: `${GUEST_SESSION_COOKIE}=${session}` } })
    expect(locationOf(response)!.origin).toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)
    expect(member.rsvp.eventId).toBe(termin.id)

    // Mit PIN-geschütztem Einzel-Event und PIN-Cookie, aber ohne eigene Antwort: zurück zur Event-Seite
    await unlockPin(context, `event_pin_${event.id}`, '4711')
    response = await page.request.get(`/api/feedback-link/${event.id}`, { maxRedirects: 0 })
    expect(locationOf(response)!.pathname).toBe(`/${event.slug}`)
    await context.close()
  })
})

test('Event-Seite: "Feedback geben" nur für Gäste, die dürfen, ab dem Ende', async ({ page }) => {
  const { owner, event } = await pastEvent()
  const guest = await createRsvp(event)
  await page.goto(`/${event.slug}?token=${guest.participant.editToken}`)
  await expect(feedbackLink(page)).toHaveAttribute('href', `/api/feedback-link/${event.id}?token=${guest.participant.editToken}`)

  const waitlisted = await createRsvp(event, { isOnWaitlist: true })
  await page.goto(`/${event.slug}?token=${waitlisted.participant.editToken}`)
  await expect(page.getByLabel('Dein Name')).toBeVisible()
  await expect(feedbackLink(page)).toHaveCount(0)
  await page.goto(`/${event.slug}`)
  await expect(feedbackLink(page)).toHaveCount(0)

  const running = await createEvent(owner, { date: hoursAgo(1), duration: 4, feedbackUrl: surveyUrl() })
  const runningGuest = await createRsvp(running)
  await page.goto(`/${running.slug}?token=${runningGuest.participant.editToken}`)
  await expect(page.getByLabel('Dein Name')).toBeVisible()
  await expect(feedbackLink(page)).toHaveCount(0)

  // Termin einer Reihe
  const series = await createSeries(owner)
  const termin = await createTermin(series, { date: hoursAgo(6), duration: 4, feedbackUrl: surveyUrl() })
  const member = await createRsvp(termin)
  await page.goto(`/reihe/${series.slug}/${termin.slug}?token=${member.participant.editToken}`)
  await expect(feedbackLink(page)).toBeVisible()
})

test('Cron: einmal je Zusage nach der Verzögerung, nur wer darf, nicht ohne Verzögerung', async ({ request }) => {
  const { owner, event } = await pastEvent({ feedbackDelayHours: 0, enableCheckin: true })
  const checkedIn = await createRsvp(event)
  await prisma.rsvp.update({ where: { id: checkedIn.rsvp.id }, data: { hasAttended: true } })
  const absent = await createRsvp(event)
  const waitlisted = await createRsvp(event, { isOnWaitlist: true })
  const tooEarly = await createEvent(owner, { date: hoursAgo(6), duration: 4, feedbackUrl: surveyUrl(), feedbackDelayHours: 12 })
  const tooEarlyGuest = await createRsvp(tooEarly)
  const noMail = await createEvent(owner, { date: hoursAgo(6), duration: 4, feedbackUrl: surveyUrl(), feedbackDelayHours: null })
  const noMailGuest = await createRsvp(noMail)
  const longAgo = await createEvent(owner, { date: hoursAgo(10 * 24), duration: 4, feedbackUrl: surveyUrl(), feedbackDelayHours: 0 })
  const longAgoGuest = await createRsvp(longAgo)

  const sentAt = async (id: string) => (await prisma.rsvp.findUniqueOrThrow({ where: { id } })).feedbackSentAt

  const run = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(run.ok()).toBe(true)
  expect((await run.json()).feedbackRequests).toBeGreaterThanOrEqual(1)
  const first = await sentAt(checkedIn.rsvp.id)
  expect(first).not.toBeNull()
  for (const [name, id] of [['nicht eingecheckt', absent.rsvp.id], ['Warteliste', waitlisted.rsvp.id], ['zu früh', tooEarlyGuest.rsvp.id], ['ohne Versand', noMailGuest.rsvp.id], ['zu lange her', longAgoGuest.rsvp.id]] as const) {
    expect(await sentAt(id), name).toBeNull()
  }

  // Zweiter Lauf: niemand bekommt ihn doppelt
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(await sentAt(checkedIn.rsvp.id)).toEqual(first)

  // Später eingecheckt: kommt beim nächsten Lauf dran
  await prisma.rsvp.update({ where: { id: absent.rsvp.id }, data: { hasAttended: true } })
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(await sentAt(absent.rsvp.id)).not.toBeNull()
})
