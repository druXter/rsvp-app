import { expect, test, type Page } from '@playwright/test'
import { BASE_URL, REDIRECT_PORT, UNREACHABLE_IDP } from '../../playwright.config'
import { createAccount, PASSWORD, uniqueIp } from './helpers'

// Bevorzugter Anbieter (SUITE_LOGIN_REDIRECT, Idee Q5 der Suite): Die zweite Instanz aus
// playwright.config.ts hat einen bevorzugten Anbieter, der nicht erreichbar ist. Ihre Login-Seite
// leitet ohne Sitzung dorthin weiter; die Anmeldung scheitert und landet über BASE_URL mit Meldung beim
// Formular der ersten Instanz (gleiche Datenbank, Cookies sind nicht an Ports gebunden) - keine Schleife.

const RSVP = new URL(BASE_URL).origin
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}`
const passwordField = (page: Page) => page.getByLabel('Passwort')

test('Login-Seite leitet zum bevorzugten Anbieter; scheitert die Anmeldung, bleibt das Formular mit Meldung', async ({ page }) => {
  await page.goto(`${REDIRECT}/admin/login`)
  await page.waitForURL(url => url.origin === RSVP && url.searchParams.get('error') === 'idp-unreachable')
  expect(new URL(page.url()).pathname).toBe('/admin/login')
  await expect(page.getByText('Das andere Tool ist gerade nicht erreichbar.')).toBeVisible()
  await expect(passwordField(page)).toBeVisible()
})

test('Formular statt Weiterleitung: nach Fehler, Reset, mit local und wenn rsvp-app selbst Anbieter ist', async ({ page }) => {
  const authorize = `/api/suite/authorize?app=${encodeURIComponent('http://localhost:2999')}&state=${'s'.repeat(43)}`
  for (const query of ['?error=1', '?error=idp-unreachable', '?reset=1', '?local=1', `?next=${encodeURIComponent(authorize)}`]) {
    await page.goto(`${REDIRECT}/admin/login${query}`)
    await expect(passwordField(page), query).toBeVisible()
    expect(new URL(page.url()).origin, query).toBe(REDIRECT)
  }
})

test('lokaler Login bleibt erreichbar (ohne JavaScript sichtbar); Abmelden führt nicht zurück zum Anbieter', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`${REDIRECT}/admin/login`)
  await expect(page.getByRole('heading', { name: 'Anmelden mit Nirgendwo' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'hier weiter' })).toHaveAttribute('href', `/api/suite/login?idp=${encodeURIComponent(UNREACHABLE_IDP)}&next=%2Fadmin`)
  await page.getByRole('link', { name: 'Stattdessen mit E-Mail und Passwort anmelden' }).click()
  await expect(passwordField(page)).toBeVisible()
  await context.close()

  const account = await createAccount('CREATOR')
  const js = await browser.newPage()
  await js.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await js.goto(`${REDIRECT}/admin/login?local=1`)
  await js.getByLabel('E-Mail').fill(account.email)
  await passwordField(js).fill(PASSWORD)
  await js.getByRole('button', { name: 'Einloggen' }).click()
  await js.waitForURL(url => url.pathname === '/admin')

  await js.getByRole('button', { name: 'Abmelden' }).click()
  await js.waitForURL(url => url.pathname === '/admin/login' && url.searchParams.get('local') === '1')
  await expect(passwordField(js)).toBeVisible()
  expect(new URL(js.url()).origin).toBe(REDIRECT)
  await js.close()
})

test('ohne SUITE_LOGIN_REDIRECT (erste Instanz) bleibt alles beim Alten', async ({ page }) => {
  await page.goto('/admin/login')
  await expect(passwordField(page)).toBeVisible()
  await expect(page.getByRole('link', { name: /^Mit .* anmelden$/ })).toHaveCount(0)
})
