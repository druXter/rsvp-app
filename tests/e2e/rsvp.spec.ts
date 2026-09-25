import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Event, GuestUser } from '@prisma/client'
import {
  BASE_URL, cookieHeader, createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries,
  createTermin, guestLogin, locationOf, prisma, readForm, sha256, submitForm, uniqueEmail, unlockPin
} from './helpers'

// Die Antwort-Logik (performRsvpSubmission) teilen sich Web-Formular und Client-API. Geprüft
// wird hier, wer antworten darf (API-Token + Mitgliedschaft, Konto-Zwang, Event-/Reihen-PIN)
// und dass eine erneute Antwort die bisherige ERSETZT statt eine zweite anzulegen.

async function answer(request: APIRequestContext, token: string | null, eventId: string, body: Record<string, unknown>, rawAuth?: string) {
  const authorization = rawAuth ?? (token ? `Bearer ${token}` : undefined)
  return request.post(`/api/v1/termine/${eventId}/antwort`, { data: body, headers: authorization ? { authorization } : {} })
}

async function member(seriesId: string): Promise<{ guest: GuestUser; token: string }> {
  const guest = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId } })
  return { guest, token: await createApiToken(guest) }
}

/** Füllt das RSVP-Formular der aktuellen Seite aus, schickt es ab und wartet auf die Antwort des Servers. */
async function submitRsvpForm(page: Page, fields: Record<string, string> = {}) {
  await page.getByLabel('Dein Name').fill('Formular-Gast')
  await page.locator('input[name="isAttending"][value="true"]').check()
  // Manipulierte Felder, wie sie jemand über die Entwicklerwerkzeuge des Browsers einträgt.
  await page.locator('form:has(input[name="isAttending"])').evaluate((form, entries) => {
    for (const [name, value] of Object.entries(entries)) {
      let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      if (!input) {
        input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        form.appendChild(input)
      }
      input.value = value
    }
  }, fields)
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith(BASE_URL))
  await page.getByRole('button', { name: /^(Antwort absenden|Änderungen speichern)$/ }).click()
  return response
}

const rsvpsOn = (event: Event) => prisma.rsvp.findMany({ where: { eventId: event.id }, include: { participant: true } })

test.describe('Client-API (/api/v1)', () => {
  test('nur mit gültigem Token und nur für Termine der eigenen Reihen', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner)
    const otherSeries = await createSeries(owner)
    const termin = await createTermin(series)
    const foreignTermin = await createTermin(otherSeries)
    const standalone = await createEvent(owner)
    const { token } = await member(series.id)

    for (const auth of ['', 'Bearer ', 'Bearer falsch', `Bearer ${sha256(token)}`, `Basic ${token}`, token]) {
      const response = await answer(request, null, termin.id, { isAttending: true }, auth)
      expect(response.status(), `Authorization: "${auth.slice(0, 20)}"`).toBe(401)
    }
    expect((await answer(request, token, foreignTermin.id, { isAttending: true })).status()).toBe(403)
    expect((await answer(request, token, standalone.id, { isAttending: true })).status()).toBe(404)
    expect((await answer(request, token, 'gibt-es-nicht', { isAttending: true })).status()).toBe(404)
    expect(await prisma.rsvp.count({ where: { eventId: { in: [termin.id, foreignTermin.id, standalone.id] } } })).toBe(0)

    // Ein Gast-Token öffnet keine Admin-Endpunkte.
    const exportResponse = await request.get(`/api/export?eventId=${termin.id}`, { headers: { authorization: `Bearer ${token}` } })
    expect(exportResponse.status()).toBe(401)

    // Positivkontrolle
    const ok = await answer(request, token, termin.id, { isAttending: true })
    expect(ok.status()).toBe(200)
    expect(await prisma.rsvp.count({ where: { eventId: termin.id } })).toBe(1)
  })

  test('erneute Antwort ersetzt die bisherige; Name und Profil kommen immer aus dem Konto', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner)
    const termin = await createTermin(series)
    const { guest, token } = await member(series.id)

    for (const body of [
      { isAttending: true, name: 'Angreifer', email: 'fremd@example.test' },
      { isAttending: true, bringingItem: 'Kuchen' },
      { isAttending: false, declineReason: 'krank' }
    ]) {
      expect((await answer(request, token, termin.id, body)).status()).toBe(200)
    }

    const rsvps = await rsvpsOn(termin)
    expect(rsvps).toHaveLength(1)
    expect(rsvps[0]).toMatchObject({ isAttending: false, declineReason: 'krank', bringingItem: null })
    expect(rsvps[0].participant).toMatchObject({ guestUserId: guest.id, name: guest.name, email: guest.email })
    expect(await prisma.participant.count({ where: { guestUserId: guest.id } })).toBe(1)
  })

  test('Web-Formular und API landen bei derselben Antwort', async ({ page, request }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner)
    const termin = await createTermin(series)
    const { guest, token } = await member(series.id)
    await answer(request, token, termin.id, { isAttending: false })

    await guestLogin(page, guest.email)
    await page.goto(`/reihe/${series.slug}/${termin.slug}`)
    expect((await submitRsvpForm(page)).status()).toBe(200)
    await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()

    const rsvps = await rsvpsOn(termin)
    expect(rsvps).toHaveLength(1)
    expect(rsvps[0].isAttending).toBe(true)
    expect(rsvps[0].participant.guestUserId).toBe(guest.id)
  })

  test('Kapazität: eine erneute Zusage behält ihren Platz, Nachrücken in Reihenfolge der Anmeldung', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner)
    const termin = await createTermin(series, { maxCapacity: 1 })
    const a = await member(series.id)
    const b = await member(series.id)
    const c = await member(series.id)
    const waitlisted = async (guest: GuestUser) =>
      (await prisma.rsvp.findFirstOrThrow({ where: { eventId: termin.id, participant: { guestUserId: guest.id } } })).isOnWaitlist

    for (const m of [a, b, c]) await answer(request, m.token, termin.id, { isAttending: true })
    expect([await waitlisted(a.guest), await waitlisted(b.guest), await waitlisted(c.guest)]).toEqual([false, true, true])

    // Erneut zusagen: A behält den Platz, C überholt B nicht.
    await answer(request, a.token, termin.id, { isAttending: true })
    await answer(request, c.token, termin.id, { isAttending: true })
    expect([await waitlisted(a.guest), await waitlisted(b.guest), await waitlisted(c.guest)]).toEqual([false, true, true])

    // A sagt ab: B (früher angemeldet) rückt nach, C bleibt auf der Warteliste.
    await answer(request, a.token, termin.id, { isAttending: false })
    expect([await waitlisted(b.guest), await waitlisted(c.guest)]).toEqual([false, true])
    expect(await prisma.rsvp.count({ where: { eventId: termin.id } })).toBe(3)
    expect(await prisma.rsvp.count({ where: { eventId: termin.id, isAttending: true, isOnWaitlist: false } })).toBe(1)
  })
})

test.describe('Konto-Zwang und persönliche Links (editToken)', () => {
  test('ein fremder oder erfundener editToken umgeht den Konto-Zwang nicht; der eigene schon', async ({ browser }) => {
    const owner = await createAccount('CREATOR')
    const open = await createEvent(owner)
    const gated = await createEvent(owner, { requireGuestUser: true })
    const { participant: fromOpenEvent } = await createRsvp(open)
    // Hat schon vor der Umstellung auf "nur mit Konto" geantwortet.
    const { participant: earlier } = await createRsvp(gated, { isAttending: false })

    // Ohne Token zeigt die Seite nur das Login-Gate.
    const plain = await browser.newPage()
    await plain.goto(`/${gated.slug}`)
    await expect(plain.getByLabel('Dein Name')).toHaveCount(0)

    // Gültiger Token eines ANDEREN, offenen Events: Die Seite übernimmt ihn ins Formular ...
    const borrowed = await browser.newPage()
    await borrowed.goto(`/${gated.slug}?token=${fromOpenEvent.editToken}`)
    expect((await submitRsvpForm(borrowed)).status()).toBe(500)

    // ... erfundener Token, per Entwicklerwerkzeug ins Formular des offenen Events geschrieben.
    const invented = await browser.newPage()
    await invented.goto(`/${open.slug}`)
    expect((await submitRsvpForm(invented, { eventId: gated.id, editToken: 'erfunden' })).status()).toBe(500)

    let rsvps = await rsvpsOn(gated)
    expect(rsvps).toHaveLength(1)
    expect(rsvps[0].participantId).toBe(earlier.id)
    expect(await prisma.rsvp.count({ where: { participantId: fromOpenEvent.id } })).toBe(1)

    // Positivkontrolle: der eigene Link ändert die bestehende Antwort (ersetzt, nicht verdoppelt).
    const own = await browser.newPage()
    await own.goto(`/${gated.slug}?token=${earlier.editToken}`)
    expect((await submitRsvpForm(own)).status()).toBe(200)
    await expect(own.getByText('Danke für deine Anmeldung!')).toBeVisible()
    rsvps = await rsvpsOn(gated)
    expect(rsvps).toHaveLength(1)
    expect(rsvps[0]).toMatchObject({ participantId: earlier.id, isAttending: true })
  })
})

test.describe('Event-/Reihen-PIN gilt auch außerhalb der Seite', () => {
  test('Antwort mit der ID eines PIN-Events wird ohne Freischaltung abgelehnt', async ({ page, context }) => {
    const owner = await createAccount('CREATOR')
    const open = await createEvent(owner)
    const locked = await createEvent(owner, { eventPin: '2468' })

    await page.goto(`/${open.slug}`)
    expect((await submitRsvpForm(page, { eventId: locked.id })).status()).toBe(500)
    expect(await prisma.rsvp.count({ where: { eventId: locked.id } })).toBe(0)

    // Eine falsche PIN im Cookie hilft ebenso wenig.
    await unlockPin(context, `event_pin_${locked.id}`, '0000')
    await page.goto(`/${open.slug}`)
    expect((await submitRsvpForm(page, { eventId: locked.id })).status()).toBe(500)
    expect(await prisma.rsvp.count({ where: { eventId: locked.id } })).toBe(0)

    // Positivkontrolle: derselbe manipulierte Aufruf mit Freischalt-Cookie wirkt.
    await unlockPin(context, `event_pin_${locked.id}`, '2468')
    await page.goto(`/${open.slug}`)
    expect((await submitRsvpForm(page, { eventId: locked.id })).status()).toBe(200)
    expect(await prisma.rsvp.count({ where: { eventId: locked.id } })).toBe(1)
  })

  test('Kalenderdatei: nur mit PIN oder mit dem eigenen persönlichen Token', async ({ page, context }) => {
    const owner = await createAccount('CREATOR')
    const open = await createEvent(owner)
    const locked = await createEvent(owner, { eventPin: '2468', title: 'Geheimes Treffen' })
    const { participant: foreign } = await createRsvp(open)
    const { participant: own } = await createRsvp(locked)

    const ical = async (query = '') =>
      page.request.get(`/api/ical/${locked.id}${query}`, { headers: await cookieHeader(context) })

    for (const query of ['', '?token=erfunden', `?token=${foreign.editToken}`]) {
      const response = await ical(query)
      expect(response.status(), query).toBe(403)
      expect(await response.text()).not.toContain('Geheimes Treffen')
    }
    await unlockPin(context, `event_pin_${locked.id}`, '0000')
    expect((await ical()).status()).toBe(403)

    // Positivkontrollen
    const withToken = await ical(`?token=${own.editToken}`)
    expect(withToken.status()).toBe(200)
    expect(await withToken.text()).toContain('Geheimes Treffen')
    await unlockPin(context, `event_pin_${locked.id}`, '2468')
    expect((await ical()).status()).toBe(200)
  })

  test('bei Reihen-Terminen gilt die PIN der Reihe, die des Termins ist wirkungslos', async ({ page, context }) => {
    const owner = await createAccount('CREATOR')
    const lockedSeries = await createSeries(owner, { eventPin: '1357' })
    const inLockedSeries = await createTermin(lockedSeries)
    const openSeries = await createSeries(owner)
    const withOwnPin = await createTermin(openSeries, { eventPin: '9999' })
    const status = async (event: Event) =>
      (await page.request.get(`/api/ical/${event.id}`, { headers: await cookieHeader(context) })).status()

    expect(await status(inLockedSeries)).toBe(403)
    // Ein Event-Cookie mit der richtigen Reihen-PIN reicht nicht - es zählt das Reihen-Cookie.
    await unlockPin(context, `event_pin_${inLockedSeries.id}`, '1357')
    expect(await status(inLockedSeries)).toBe(403)
    await unlockPin(context, `series_pin_${lockedSeries.id}`, '1357')
    expect(await status(inLockedSeries)).toBe(200)

    // Die eigene PIN eines Termins in einer offenen Reihe sperrt nichts.
    expect(await status(withOwnPin)).toBe(200)
  })

  test('Registrierung für eine PIN-geschützte Reihe nur mit Freischaltung', async ({ page, context }) => {
    const owner = await createAccount('CREATOR')
    const open = await createSeries(owner)
    const locked = await createSeries(owner, { eventPin: '1357' })
    await page.goto(`/reihe/${open.slug}/registrieren`)
    const form = await readForm(page, 'form:has(input[name="seriesId"])')
    const fields = (email: string) => ({ seriesId: locked.id, name: 'Neu', email, password: 'ein sicheres Passwort' })

    const denied = uniqueEmail('ohne-pin')
    expect(locationOf(await submitForm(page, form, fields(denied)))?.searchParams.get('error')).toBe('pin')
    expect(await prisma.guestUser.findUnique({ where: { email: denied } })).toBeNull()

    // Positivkontrolle
    await unlockPin(context, `series_pin_${locked.id}`, '1357')
    const allowed = uniqueEmail('mit-pin')
    expect(locationOf(await submitForm(page, form, fields(allowed)))?.pathname).toBe('/mein-konto/login')
    const created = await prisma.guestUser.findUniqueOrThrow({ where: { email: allowed }, include: { seriesMemberships: true } })
    expect(created.isVerified).toBe(false)
    expect(created.verifyToken).toMatch(/^[0-9a-f]{64}$/)
    expect(created.seriesMemberships.map(m => m.seriesId)).toEqual([locked.id])
  })
})
