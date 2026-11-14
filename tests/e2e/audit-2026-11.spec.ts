import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { expect, test, type Page, type Request as BrowserRequest } from '@playwright/test'
import { TEST_ABSTIMMUNGSTOOL_BASE_URL } from '../../playwright.config'
import {
  BASE_URL, cookieHeader, createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin, decodeCouplingToken,
  locationOf, plantGuestSession, powSolution, prisma, readForm, submitForm, unique, uniqueEmail, uniqueIp
} from './helpers'

// Sicherheitsprüfung November 2026 (docs/AUDIT-2026-11.md): je Fund ein Test mit der Kennung im Titel. Jeder beginnt
// mit einer Gegenprobe (der erlaubte Fall geht durch) und scheitert erst an der Zeile, die den Fund zeigt. Mit der
// Behebung werden sie grün und bleiben als Regressionstests. Reine Logik: tests/unit/audit-2026-11.test.ts.

const WITH_EMAIL = JSON.stringify({ askEmail: true, askPhone: false, askDiet: false, askAlcohol: false, askBringingItem: false, askAllergies: false })
const POW_MESSAGE = 'Die Sicherheitsprüfung hat nicht geklappt'

type Captured = { url: string; action: string; contentType: string; body: string }

/** Schneidet den Aufruf der Server Action mit, den `submit` im Browser auslöst (Formulare mit onSubmit). */
async function capture(page: Page, submit: () => Promise<void>): Promise<Captured> {
  const waiting = page.waitForRequest((r: BrowserRequest) => r.method() === 'POST' && !!r.headers()['next-action'])
  await submit()
  const request = await waiting
  await request.response()
  return { url: request.url(), action: request.headers()['next-action'], contentType: request.headers()['content-type'], body: request.postDataBuffer()!.toString('utf8') }
}

/** Spielt einen mitgeschnittenen Aufruf (verändert) erneut ab - ohne Cookies, wie ein fremder Client. */
async function replay(page: Page, captured: Captured, body: string) {
  const response = await page.request.post(captured.url, {
    headers: { 'next-action': captured.action, 'content-type': captured.contentType, accept: 'text/x-component', origin: BASE_URL, 'x-forwarded-for': uniqueIp() },
    data: body
  })
  return response.text()
}

const fieldPattern = (name: string) => new RegExp(`(name="(?:_?\\d+_)?${name}"\\r\\n\\r\\n)[^\\r]*`)

/** Ersetzt den Wert eines Formularfelds im mitgeschnittenen Körper. */
function setField(body: string, name: string, value: string): string {
  if (!fieldPattern(name).test(body)) throw new Error(`Kein Feld ${name} im Aufruf`)
  return body.replace(fieldPattern(name), (_m, head: string) => head + value)
}

/**
 * Fügt ein Feld hinzu, das das Formular nicht hatte: gleiches Präfix wie die übrigen Felder und VOR dem Teil "0", mit
 * dem React die Argumente der Action auflöst (später folgende Felder liest der Server nicht mehr).
 */
function addField(captured: Captured, body: string, name: string, value: string): string {
  const prefix = /name="((?:_?\d+_)?)name"/.exec(body)?.[1] ?? ''
  const boundary = /boundary=(.+)$/.exec(captured.contentType)![1]
  const root = body.indexOf(`--${boundary}\r\nContent-Disposition: form-data; name="0"`)
  const at = root >= 0 ? root : body.lastIndexOf(`--${boundary}--`)
  return `${body.slice(0, at)}--${boundary}\r\nContent-Disposition: form-data; name="${prefix}${name}"\r\n\r\n${value}\r\n${body.slice(at)}`
}

/** Füllt das Antwort-Formular einer Seite im Browser aus und schneidet das Absenden mit. */
async function captureAnswer(page: Page, path: string, fill: { name?: string; email?: string } = {}): Promise<Captured> {
  await page.goto(path)
  if (fill.name) await page.getByLabel('Dein Name').fill(fill.name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  if (fill.email) await page.getByLabel('E-Mail Adresse').fill(fill.email)
  return capture(page, () => page.locator('form button[type="submit"]').last().click())
}

test('R-01 Konto und persönlicher Link: eine fremd angelegte Antwort mit der Adresse eines Kontos gibt ihrem Link keinen Zugriff auf das Konto', async ({ browser, request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner, { askEmail: true, askPhone: true, askAllergies: true })
  const termin = await createTermin(series)
  const victim = await createGuestUser()
  await prisma.guestUser.update({ where: { id: victim.id }, data: { phone: '0170 5550123', allergies: 'Erdnuss-Allergie' } })
  await prisma.guestUserSeries.create({ data: { guestUserId: victim.id, seriesId: series.id } })

  // Jemand ohne Konto antwortet auf den Termin und trägt die Adresse des Opfers ein (das Formular nimmt jede Adresse,
  // bestätigt wird sie hier nicht). Den persönlichen Link dieser Antwort behält er.
  const planted = await prisma.participant.create({ data: { name: 'Irgendwer', email: victim.email.toUpperCase(), seriesId: series.id } })
  await prisma.rsvp.create({ data: { eventId: termin.id, participantId: planted.id, isAttending: true } })
  const strangerLink = `/reihe/${series.slug}/${termin.slug}?token=${planted.editToken}`

  // Gegenprobe: Das Opfer antwortet mit seinem Konto (hier über die Client-API, im Browser läuft es gleich).
  const answer = await request.post(`/api/v1/termine/${termin.id}/antwort`, {
    headers: { authorization: `Bearer ${await createApiToken(victim)}` }, data: { isAttending: true }
  })
  expect(answer.status()).toBe(200)
  const own = await prisma.participant.findFirstOrThrow({ where: { guestUserId: victim.id, seriesId: series.id } })
  expect(own.phone).toBe('0170 5550123')

  // Fund: Die Antwort des Kontos ist die fremd angelegte - samt ihrem alten Link. Wer ihn hat, liest Telefonnummer
  // und Allergien des Kontos, ändert dessen Antworten in der ganzen Reihe und das zentrale Profil.
  const stranger = await browser.newContext()
  const html = await (await stranger.request.get(strangerLink)).text()
  await stranger.close()
  expect(html).not.toContain('0170 5550123')
  expect(html).not.toContain('Erdnuss-Allergie')
})

test.describe('Abstimmungs-Kopplung', () => {
  let tool: Server
  const received: Record<string, unknown>[] = []

  test.beforeAll(async () => {
    tool = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try { received.push({ path: req.url, ...decodeCouplingToken(body) }) } catch { /* keine Nachricht der Kopplung */ }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    await new Promise<void>(resolve => tool.listen(Number(new URL(TEST_ABSTIMMUNGSTOOL_BASE_URL).port), '127.0.0.1', resolve))
  })
  test.afterAll(async () => { await new Promise(resolve => tool.close(resolve)) })

  test('R-02 Abstimmung: eine Absage unter einer unbestätigten Adresse geht nicht als signierte Meldung ans Abstimmungstool', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const pollId = `poll${unique()}`
    const event = await createEvent(owner, { formConfig: WITH_EMAIL, pollUrl: `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/abstimmung/${pollId}` })
    const declineVia = async (token: string, participantId: string) => {
      await page.goto(`/${event.slug}?token=${token}`)
      await page.locator('input[name="isAttending"][value="false"]').check()
      await capture(page, () => page.getByRole('button', { name: 'Änderungen speichern' }).click())
      await expect.poll(async () => (await prisma.rsvp.findFirstOrThrow({ where: { participantId } })).isAttending).toBe(false)
    }
    const absagen = (email: string) => received.filter(m => m.typ === 'poll-attendance' && m.pollId === pollId && m.email === email && m.attending === false)

    // Gegenprobe: Ein bestätigtes Konto sagt ab - das Abstimmungstool erfährt es und entfernt dessen Stimme.
    const account = await createGuestUser()
    const verified = await prisma.participant.create({ data: { name: 'Mit Konto', email: account.email, isVerified: true, verifiedAt: new Date(), guestUserId: account.id } })
    await prisma.rsvp.create({ data: { eventId: event.id, participantId: verified.id, isAttending: true } })
    await declineVia(verified.editToken, verified.id)
    expect(absagen(account.email)).toHaveLength(1)

    // Fund: Irgendwer hat mit der Adresse einer anderen Person zugesagt (nie bestätigt) und sagt wieder ab. rsvp-app
    // meldet "diese Adresse hat abgesagt" signiert ans Abstimmungstool, das daraufhin die Stimme dieser Person löscht.
    const victimEmail = uniqueEmail('waehlerin')
    const stranger = await prisma.participant.create({ data: { name: 'Irgendwer', email: victimEmail, isVerified: false, verifyToken: `vt-${unique()}` } })
    await prisma.rsvp.create({ data: { eventId: event.id, participantId: stranger.id, isAttending: true } })
    await declineVia(stranger.editToken, stranger.id)
    expect(absagen(victimEmail)).toHaveLength(0)
  })

  test('R-04 Abstimmung: der Nachweis für die Abstimmung nennt den Termin, aus dem er stammt', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const series = await createSeries(owner)
    const pollId = `poll${unique()}`
    const termin = await createTermin(series, { pollUrl: `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/abstimmung/${pollId}` })
    const guest = await createGuestUser()
    await createRsvp(termin, { guestUserId: guest.id })
    await plantGuestSession(page.context(), guest)

    const response = await page.request.get(`/api/poll-link/${termin.id}`, { headers: await cookieHeader(page.context()), maxRedirects: 0 })
    const target = locationOf(response)!
    // Gegenprobe: Ein bestätigtes Konto mit Zusage bekommt den Nachweis für genau diese Abstimmung.
    expect(`${target.origin}${target.pathname}`).toBe(`${TEST_ABSTIMMUNGSTOOL_BASE_URL}/abstimmung/${pollId}`)
    const proof = decodeCouplingToken(target.searchParams.get('verify')!)
    expect(proof).toMatchObject({ typ: 'poll-access', aud: TEST_ABSTIMMUNGSTOOL_BASE_URL, email: guest.email, pollId, attending: true })

    // Fund: Der Nachweis sagt "hat zugesagt", aber nicht wozu. Wer einen eigenen Termin auf eine FREMDE Abstimmung
    // zeigen lässt (pollUrl ist frei wählbar), stellt sich und anderen gültige Nachweise für sie aus.
    expect(proof.eventId).toBe(termin.id)
  })
})

test('R-03 Double-Opt-In: der Bestätigungs-Token steht nicht im Quelltext der Seite hinter dem persönlichen Link', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: WITH_EMAIL, requireVerification: true })
  const verifyToken = `verify-${unique()}-geheim`
  const participant = await prisma.participant.create({ data: { name: 'Noch Unbestätigt', email: uniqueEmail('fremde-adresse'), isVerified: false, verifyToken } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: participant.id, isAttending: true } })

  const context = await browser.newContext()
  const html = await (await context.request.get(`/${event.slug}?token=${participant.editToken}`)).text()
  // Gegenprobe: Der persönliche Link zeigt die eigene Antwort.
  expect(html).toContain('Noch Unbestätigt')
  // ... und der Token aus der Mail bestätigt die Adresse (Seite mit dem Knopf).
  expect(await (await context.request.get(`/verify?token=${verifyToken}`)).text()).not.toContain('Ungültiger Link')
  await context.close()

  // Fund: Die Seite reicht die ganze Participant-Zeile an das Formular im Browser - mit verifyToken. Wer eine fremde
  // Adresse einträgt, liest den Token aus dem Quelltext und bestätigt sie selbst, ohne das Postfach zu sehen.
  expect(html).not.toContain(verifyToken)
})

test('R-05 Bot-Schutz: ein erfundener editToken ersetzt die Lösung nicht', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const captured = await captureAnswer(page, `/${event.slug}`, { name: 'Mensch' })
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const named = (name: string) => setField(captured.body, 'name', name)

  // Gegenprobe: ohne Lösung abgelehnt, mit frischer Lösung angenommen.
  expect(await replay(page, captured, setField(named('Bot ohne'), 'pow', ''))).toContain(POW_MESSAGE)
  expect(await prisma.participant.count({ where: { name: 'Bot ohne' } })).toBe(0)
  expect(await replay(page, captured, setField(named('Mit Loesung'), 'pow', await powSolution(page)))).not.toContain(POW_MESSAGE)
  expect(await prisma.participant.count({ where: { name: 'Mit Loesung' } })).toBe(1)

  // Fund: Der Bot-Schutz fragt nur, ob IRGENDEIN editToken mitkam. Mit einem erfundenen entsteht eine neue Antwort
  // samt Mail, ganz ohne Lösung.
  const forged = addField(captured, setField(named('Bot mit Token'), 'pow', ''), 'editToken', 'frei-erfunden')
  await replay(page, captured, forged)
  expect(await prisma.participant.count({ where: { name: 'Bot mit Token' } })).toBe(0)
})

test('R-06 Kapazität: gleichzeitige Zusagen bekommen zusammen nicht mehr feste Plätze, als es gibt', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const member = async () => {
    const guest = await createGuestUser()
    await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId: series.id } })
    return createApiToken(guest)
  }
  const answer = (eventId: string, token: string) => request.post(`/api/v1/termine/${eventId}/antwort`, { headers: { authorization: `Bearer ${token}` }, data: { isAttending: true } })
  const fixedSeats = (eventId: string) => prisma.rsvp.count({ where: { eventId, isAttending: true, isOnWaitlist: false } })

  // Gegenprobe: nacheinander bekommt die erste Zusage den Platz, die zweite die Warteliste.
  const calm = await createTermin(series, { maxCapacity: 1 })
  for (const token of [await member(), await member()]) expect((await answer(calm.id, token)).status()).toBe(200)
  expect(await fixedSeats(calm.id)).toBe(1)
  expect(await prisma.rsvp.count({ where: { eventId: calm.id, isOnWaitlist: true } })).toBe(1)

  // Fund: Prüfen und Speichern sind zwei Schritte ohne Transaktion - gleichzeitige Zusagen sehen alle "noch frei".
  const rush = await createTermin(series, { maxCapacity: 1 })
  const tokens = await Promise.all(Array.from({ length: 8 }, member))
  const responses = await Promise.all(tokens.map(token => answer(rush.id, token)))
  expect(responses.map(r => r.status())).toEqual(Array(8).fill(200))
  expect(await fixedSeats(rush.id)).toBe(1)
})

test('R-07a E-Mail der Antwort: nur eine einzelne Adresse wird angenommen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: WITH_EMAIL })
  const captured = await captureAnswer(page, `/${event.slug}`, { name: 'Mensch', email: uniqueEmail('mensch') })
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const send = async (name: string, email: string) =>
    replay(page, captured, setField(setField(setField(captured.body, 'name', name), 'email', email), 'pow', await powSolution(page)))

  // Gegenprobe: eine gewöhnliche Adresse.
  const single = uniqueEmail('einzeln')
  await send('Einzeln', single)
  expect(await prisma.participant.count({ where: { email: single } })).toBe(1)

  // Fund: Das Feld wird nicht geprüft und geht unverändert an nodemailer, das Listen als mehrere Empfänger liest -
  // eine Antwort verschickt die Bestätigung unseres Absenders an beliebig viele Adressen.
  const many = `${uniqueEmail('eins')}, ${uniqueEmail('zwei')}; ${uniqueEmail('drei')}`
  await send('Viele', many)
  expect(await prisma.participant.count({ where: { email: many } })).toBe(0)
  await send('Keine Adresse', 'kein-at-zeichen')
  expect(await prisma.participant.count({ where: { email: 'kein-at-zeichen' } })).toBe(0)
})

test('R-07b E-Mail der Antwort: ein persönlicher Link löst nicht beliebig viele Bestätigungs-Mails an immer neue Adressen aus', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: WITH_EMAIL, requireVerification: true })
  const participant = await prisma.participant.create({ data: { name: 'Link-Besitz', email: uniqueEmail('start'), isVerified: false, verifyToken: `vt-${unique()}` } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: participant.id, isAttending: true } })
  const stored = async () => (await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).email

  // Gegenprobe: Die eigene, noch unbestätigte Adresse lässt sich korrigieren (neue Bestätigungs-Mail).
  await page.goto(`/${event.slug}?token=${participant.editToken}`)
  const corrected = uniqueEmail('korrigiert')
  await page.getByLabel('E-Mail Adresse').fill(corrected)
  const captured = await capture(page, () => page.getByRole('button', { name: 'Änderungen speichern' }).click())
  await expect.poll(stored).toBe(corrected)

  // Fund: keine Bremse - jede weitere Änderung schickt eine Mail unseres Absenders an eine weitere fremde Adresse.
  let accepted = 0
  for (let i = 0; i < 30; i++) {
    const next = uniqueEmail(`ziel${i}`)
    await replay(page, captured, setField(captured.body, 'email', next))
    if ((await stored()) === next) accepted++
  }
  expect(accepted).toBeLessThan(30)
})

test('R-09 PIN: das Freischalt-Cookie trägt nicht die PIN selbst und ist Secure', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const pin = `pin-${unique()}`
  const event = await createEvent(owner, { eventPin: pin })
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${event.slug}`)
  await page.getByPlaceholder('Event-PIN eingeben').fill(pin)
  await page.locator('form button[type="submit"]').click()
  // Gegenprobe: Mit der richtigen PIN erscheint das Formular.
  await expect(page.getByLabel('Dein Name')).toBeVisible()

  const cookie = (await page.context().cookies()).find(c => c.name === `event_pin_${event.id}`)!
  expect(cookie.httpOnly).toBe(true)
  // Fund: Die PIN liegt 30 Tage im Klartext im Cookie und geht ohne Secure auch über http mit.
  expect(cookie.value).not.toBe(pin)
  expect(cookie.secure).toBe(true)
})

test('R-10 Kalenderdatei: ein beliebiger Wert in ?token= landet nicht in der Datei', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const { participant } = await createRsvp(event)

  // Gegenprobe: Mit dem eigenen Link steht er als "Antwort bearbeiten" in der Datei.
  const own = await (await request.get(`/api/ical/${event.id}?token=${participant.editToken}`)).text()
  expect(own).toContain('BEGIN:VEVENT')
  expect(own.replace(/\r\n /g, '')).toContain(participant.editToken)

  // Fund: Bei einem Termin ohne PIN wird ?token= ungeprüft in die Beschreibung geschrieben - ein Link auf unsere
  // Adresse liefert eine Kalenderdatei mit fremdem Text.
  const marker = `BITTE-ANRUFEN-${unique()}`
  const forged = await (await request.get(`/api/ical/${event.id}?token=${marker}`)).text()
  expect(forged).toContain('BEGIN:VEVENT')
  expect(forged.replace(/\r\n /g, '')).not.toContain(marker)
})

test('R-11 Registrierung: die Antwort verrät nicht, ob es zu einer Adresse schon ein Konto gibt', async ({ page }) => {
  await page.goto('/mein-konto/registrieren')
  const form = await readForm(page, 'form:has(input[name="email"])')
  const register = (email: string) => submitForm(page, form, { name: 'Neu', email, password: 'ein sicheres Passwort' })

  // Gegenprobe: neue Adresse.
  const fresh = locationOf(await register(uniqueEmail('neu')))!
  expect(fresh.searchParams.get('registered')).toBe('1')

  // Fund: "exists" unterscheidet vergebene von freien Adressen (Login und Passwort-Reset tun das bewusst nicht).
  const existing = await createGuestUser()
  const taken = locationOf(await register(existing.email))!
  expect(`${taken.pathname}${taken.search}`).toBe(`${fresh.pathname}${fresh.search}`)
})

test('R-12 Auskunft: Antworten unter einer nie bestätigten Adresse sind als solche gekennzeichnet', async () => {
  const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const email = uniqueEmail('auskunft')
  const confirmed = await prisma.participant.create({ data: { name: 'Selbst bestätigt', email, isVerified: true, verifiedAt: new Date() } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: confirmed.id, isAttending: true } })

  // Gegenprobe: Die bestätigte Antwort steht in der Auskunft, ohne Warnhinweis.
  const before = run(email)
  expect(before.daten.antworten.map((p: { name: string }) => p.name)).toEqual(['Selbst bestätigt'])
  expect(before.hinweise.join(' ')).not.toMatch(/bestätigt/i)

  // Fund: Jemand anderes hat dieselbe Adresse eingetippt (nie bestätigt). Dessen Telefonnummer und Allergien gehen
  // ohne jeden Hinweis in die Auskunft an die anfragende Person - und --loeschen --ja löscht dessen Antwort mit.
  const stranger = await prisma.participant.create({ data: { name: 'Fremde Person', email, phone: '0151 000111', allergies: 'Sellerie', isVerified: false } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: stranger.id, isAttending: true } })
  const after = run(email)
  expect(after.daten.antworten).toHaveLength(2)
  expect(after.hinweise.join(' ')).toMatch(/nicht bestätigt|unbestätigt/i)
})

test('R-13 Freitext der Antwort: überlange Angaben werden nicht gespeichert', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series)
  const guest = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId: series.id } })
  const headers = { authorization: `Bearer ${await createApiToken(guest)}` }
  const info = async () => (await prisma.rsvp.findFirstOrThrow({ where: { eventId: termin.id } })).additionalInfo

  // Gegenprobe: eine gewöhnliche Anmerkung.
  expect((await request.post(`/api/v1/termine/${termin.id}/antwort`, { headers, data: { isAttending: true, additionalInfo: 'Komme etwas später' } })).status()).toBe(200)
  expect(await info()).toBe('Komme etwas später')

  // Fund: keine Obergrenze für Anmerkung, Mitbringsel, Absagegrund und Zusatzantworten (im Formular auch nicht für
  // Name, Telefon und Allergien) - gespeichert wird, was in die Anfrage passt (API 100 kB, Formular 2 MB).
  await request.post(`/api/v1/termine/${termin.id}/antwort`, { headers, data: { isAttending: true, additionalInfo: 'x'.repeat(90_000) } })
  expect((await info())!.length).toBeLessThanOrEqual(5_000)
})
