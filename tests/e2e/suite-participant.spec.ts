import { createServer, type Server } from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { randomState, verifyParticipantAssertion } from 'suite-kit'
import { BASE_URL, createAccount, createGuestUser, FOREIGN_TOOL_BASE_URL, guestLogin, login, PASSWORD, prisma, uniqueIp } from './helpers'
import { TEST_PARTICIPANT_APPS } from '../../playwright.config'

// Konto-Verbund für TEILNEHMENDENKONTEN, rsvp-app als Anbieter (suite-kit v0.2.0, Teilnehmenden-
// Bestätigung): Gast-Login, Zustimmung pro Tool, paarweise Kennung, keine E-Mail, Entzug. Die
// Empfänger-Tools laufen nicht - der Browser wird an ihrer Callback-Adresse abgefangen.

const ORIGIN = new URL(BASE_URL).origin
const [VOTE, OTHER] = TEST_PARTICIPANT_APPS

function authorizeUrl(app: string, state = randomState(), kind: string | null = 'participant') {
  const params = new URLSearchParams({ app, state })
  if (kind) params.set('kind', kind)
  return `/api/suite/authorize?${params}`
}

// Die Empfänger: winzige HTTP-Server, die jeden Aufruf mit 200 beantworten - der Test liest die
// Callback-Adresse samt Bestätigung dann aus der URL des Browsers.
let receivers: Server[] = []
test.beforeAll(async () => {
  receivers = await Promise.all(TEST_PARTICIPANT_APPS.map(app => new Promise<Server>((resolve, reject) => {
    const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('beim Empfänger angekommen'))
    server.once('error', reject)
    server.listen(Number(new URL(app).port), '127.0.0.1', () => resolve(server))
  })))
})
test.afterAll(async () => {
  await Promise.all(receivers.map(server => new Promise(resolve => server.close(resolve))))
})

/** Löst `trigger` aus und wartet, bis der Browser beim Callback des Empfängers `app` ankommt. */
async function catchCallback(page: Page, app: string, trigger: () => Promise<unknown>): Promise<URL> {
  await trigger()
  await page.waitForURL(url => url.origin === app, { timeout: 15_000 })
  return new URL(page.url())
}

async function verify(page: Page, callback: URL, app: string) {
  const discovery = await (await page.request.get('/.well-known/suite-identity')).json()
  const assertion = callback.searchParams.get('assertion')!
  const state = callback.searchParams.get('state')!
  expect(callback.pathname).toBe('/api/suite/callback')
  const payload = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
  expect(payload.email).toBeUndefined()
  return verifyParticipantAssertion(assertion, { issuer: ORIGIN, audience: app, nonce: state, keys: discovery.keys })
}

test('Erster Login: Gast-Login, Zustimmung, Bestätigung mit Name und paarweiser Kennung', async ({ page }) => {
  const guest = await createGuestUser()
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })

  // Nicht angemeldet -> Gast-Login (nicht der Verwaltungs-Login), danach geht es weiter.
  await page.goto(authorizeUrl(VOTE))
  await expect(page).toHaveURL(/\/mein-konto\/login\?next=/)
  await page.getByLabel('E-Mail').fill(guest.email)
  await page.getByLabel('Passwort').fill(PASSWORD)
  await page.getByRole('button', { name: 'Einloggen' }).click()

  // Zustimmungsseite: wer fragt, was übertragen wird - die E-Mail nicht.
  await expect(page.getByRole('heading', { name: 'Anmelden in einem anderen Tool' })).toBeVisible()
  await expect(page.getByText(`${new URL(VOTE).host} möchte dich`)).toBeVisible()
  await expect(page.getByText(guest.name)).toBeVisible()
  await expect(page.getByText(guest.email)).toHaveCount(0)
  const callback = await catchCallback(page, VOTE, () => page.getByRole('button', { name: 'Erlauben und weiter' }).click())
  const result = await verify(page, callback, VOTE)
  expect(result.ok).toBe(true)
  const consent = await prisma.guestToolConsent.findUniqueOrThrow({ where: { guestUserId_app: { guestUserId: guest.id, app: VOTE } } })
  if (result.ok) {
    expect(result.claims.name).toBe(guest.name)
    expect(result.claims.sub).toBe(consent.subject)
    expect(result.claims.sub).not.toBe(guest.id)
  }
  expect(consent.lastUsedAt).not.toBeNull()

  // Zweites Mal: ohne Rückfrage, dieselbe Kennung. Ein anderes Tool bekommt eine andere.
  const again = await verify(page, await catchCallback(page, VOTE, () => page.goto(authorizeUrl(VOTE))), VOTE)
  expect(again.ok && again.claims.sub).toBe(consent.subject)

  await page.goto(authorizeUrl(OTHER))
  const other = await verify(page, await catchCallback(page, OTHER, () => page.getByRole('button', { name: 'Erlauben und weiter' }).click()), OTHER)
  expect(other.ok).toBe(true)
  expect(other.ok && other.claims.sub).not.toBe(consent.subject)
})

test('Freigabe entziehen: erneute Rückfrage, danach wieder dieselbe Kennung', async ({ page }) => {
  const guest = await createGuestUser()
  await guestLogin(page, guest.email)
  await page.goto(authorizeUrl(VOTE))
  const first = await verify(page, await catchCallback(page, VOTE, () => page.getByRole('button', { name: 'Erlauben und weiter' }).click()), VOTE)

  await page.goto('/mein-konto/account')
  const consents = page.getByRole('list', { name: 'Freigaben für andere Tools' })
  await expect(consents.getByText(new URL(VOTE).host)).toBeVisible()
  await consents.getByRole('button', { name: 'Freigabe entziehen' }).click()
  await expect(page.getByText('Freigabe entzogen.')).toBeVisible()

  await page.goto(authorizeUrl(VOTE))
  await expect(page.getByRole('button', { name: 'Erlauben und weiter' })).toBeVisible()
  const second = await verify(page, await catchCallback(page, VOTE, () => page.getByRole('button', { name: 'Erlauben und weiter' }).click()), VOTE)
  expect(first.ok && second.ok && second.claims.sub === first.claims.sub).toBe(true)
})

test('Nur freigegebene Tools, nur Gast-Sitzungen, nur bestätigte Konten', async ({ page }) => {
  // Ein nicht eingetragenes Tool bekommt nie eine Weiterleitung.
  const guest = await createGuestUser()
  await guestLogin(page, guest.email)
  await page.goto(authorizeUrl(FOREIGN_TOOL_BASE_URL))
  await expect(page).toHaveURL(/\/mein-konto\/freigabe\?error=app/)
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Dieses Tool darf keine Anmeldung')
  // Auch die Zustimmungsseite selbst nimmt kein fremdes Tool an.
  await page.goto(`/mein-konto/freigabe?app=${encodeURIComponent(FOREIGN_TOOL_BASE_URL)}&state=${randomState()}`)
  await expect(page.getByRole('button', { name: 'Erlauben und weiter' })).toHaveCount(0)

  // Unbekannte kind-Werte und Verwaltungs-Bestätigungen für ein Teilnehmenden-Tool: abgelehnt.
  await page.goto(authorizeUrl(VOTE, randomState(), 'admin'))
  await expect(page).toHaveURL(/error=app/)
  await page.goto(authorizeUrl(VOTE, randomState(), null))
  await expect(page).toHaveURL(/\/admin\/login\?error=app/)

  // Ein nachträglich nicht mehr bestätigtes Konto bekommt keine Bestätigung.
  await prisma.guestUser.update({ where: { id: guest.id }, data: { isVerified: false } })
  await page.goto(authorizeUrl(VOTE))
  await expect(page).toHaveURL(/\/mein-konto\/freigabe\?error=unverified/)
})

test('Eine Verwaltungs-Sitzung zählt nicht als Teilnehmendenkonto', async ({ page }) => {
  const staff = await createAccount('ADMIN')
  await login(page, staff.email)
  await page.goto(authorizeUrl(VOTE))
  await expect(page).toHaveURL(/\/mein-konto\/login\?next=/)
  expect(await prisma.guestToolConsent.count({ where: { app: VOTE, guestUser: { email: staff.email } } })).toBe(0)
})
