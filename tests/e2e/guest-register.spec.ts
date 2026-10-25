import { expect, test } from '@playwright/test'
import { guestLogin, locationOf, plantGuestSession, prisma, readForm, submitForm, uniqueEmail, uniqueIp, createGuestUser } from './helpers'

// Allgemeine Registrierung eines Teilnehmendenkontos (/mein-konto/registrieren) - ohne Reihe oder Event.

test('Konto ohne Reihe anlegen: von der Login-Seite, unbestätigt, danach leeres Mein Konto mit Hinweis', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto('/mein-konto/login')
  await page.getByRole('link', { name: 'Konto anlegen' }).click()
  await expect(page).toHaveURL(/\/mein-konto\/registrieren$/)

  const email = uniqueEmail('neu')
  await page.getByLabel('Name').fill('Nora Neu')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill('ein sicheres Passwort')
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await expect(page).toHaveURL(/\/mein-konto\/login\?registered=1/)
  const created = await prisma.guestUser.findUniqueOrThrow({ where: { email }, include: { seriesMemberships: true } })
  expect(created).toMatchObject({ name: 'Nora Neu', isVerified: false })
  expect(created.verifyToken).toMatch(/^[0-9a-f]{64}$/)
  expect(created.seriesMemberships).toEqual([])

  // Unbestätigt kein Login; bestätigt: Mein Konto ohne Termine, mit Erklärung
  await guestLogin(page, email, 'ein sicheres Passwort')
  await expect(page).toHaveURL(/error=unverified/)
  await prisma.guestUser.update({ where: { id: created.id }, data: { isVerified: true, verifyToken: null } })
  await guestLogin(page, email, 'ein sicheres Passwort')
  await page.goto('/mein-konto')
  await expect(page.getByText('Noch keine Termine.')).toBeVisible()
})

test('Registrierung: vorhandene Adresse, schwaches Passwort, ohne Bot-Schutz abgelehnt; angemeldet weiter zu Mein Konto', async ({ page, browser }) => {
  const existing = await createGuestUser()
  await page.goto('/mein-konto/registrieren')
  const form = await readForm(page, 'form:has(input[name="password"])')
  const fields = (email: string, password = 'ein sicheres Passwort') => ({ name: 'X', email, password })
  const error = async (overrides: Record<string, string>) => locationOf(await submitForm(page, form, overrides))?.searchParams.get('error')

  expect(await error(fields(existing.email))).toBe('exists')
  expect(await error(fields(uniqueEmail('schwach'), '123'))).toBe('weak')
  const bot = uniqueEmail('bot')
  expect(await error({ ...fields(bot), pow: '' })).toBe('pow')
  expect(await prisma.guestUser.findUnique({ where: { email: bot } })).toBeNull()
  // Positivkontrolle
  const ok = uniqueEmail('ok')
  expect(locationOf(await submitForm(page, form, fields(ok)))?.pathname).toBe('/mein-konto/login')
  expect(await prisma.guestUser.findUnique({ where: { email: ok } })).not.toBeNull()

  const context = await browser.newContext()
  await plantGuestSession(context, existing)
  const loggedIn = await context.newPage()
  await loggedIn.goto('/mein-konto/registrieren')
  await expect(loggedIn).toHaveURL(/\/mein-konto$/)
})
