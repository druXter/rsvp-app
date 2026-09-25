import { expect, test, type Page } from '@playwright/test'
import {
  PASSWORD, createAccount, createEvent, createGuestUser, locationOf, prisma, readForm, submitForm, throttleKey,
  uniqueEmail, uniqueIp, type ReplayableForm
} from './helpers'

// Drosselung (app/lib/throttle.ts): 10 Fehlversuche pro E-Mail, 20 pro IP in 15 Minuten.
// Die Anfragen gehen direkt als Formular-POST raus (schneller als über die Oberfläche) - mit
// eigener X-Forwarded-For-Adresse pro Szenario; der Testserver läuft mit TRUST_PROXY_HOPS=1.

async function loginForm(page: Page, path = '/admin/login'): Promise<ReplayableForm> {
  await page.goto(path)
  return readForm(page, 'form:has(input[name="password"])')
}

type Outcome = 'ok' | 'locked' | 'wrong'

async function attempt(page: Page, form: ReplayableForm, email: string, password: string, forwardedFor: string): Promise<Outcome> {
  const response = await submitForm(page, form, { email, password }, { 'x-forwarded-for': forwardedFor })
  expect(response.status()).toBe(303)
  const target = locationOf(response)!
  if (target.pathname === '/admin' || target.pathname === '/mein-konto') return 'ok'
  return target.searchParams.get('error') === 'locked' ? 'locked' : 'wrong'
}

test('Positivkontrolle: derselbe POST mit richtigem Passwort meldet an', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('ok')
})

test('Sperre pro E-Mail beim 11. Versuch - auch mit richtigem Passwort und von anderen IPs', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  for (let i = 1; i <= 10; i++) {
    expect(await attempt(page, form, user.email, 'falsches Passwort', uniqueIp()), `Versuch ${i}`).toBe('wrong')
  }
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('locked')
  // Positivkontrolle: ein anderes Konto ist davon nicht betroffen.
  const other = await createAccount('CREATOR')
  expect(await attempt(page, form, other.email, PASSWORD, uniqueIp())).toBe('ok')
})

test('Sperre pro IP beim 21. Versuch; erfundene Einträge links in X-Forwarded-For helfen nicht', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const ip = uniqueIp()
  const form = await loginForm(page)
  for (let i = 1; i <= 20; i++) {
    // Links steht, was der Client selbst mitschickt - bei einem Proxy zählt nur der letzte Eintrag.
    expect(await attempt(page, form, uniqueEmail('spray'), 'falsches Passwort', `10.66.0.${i}, ${ip}`), `Versuch ${i}`).toBe('wrong')
  }
  expect(await attempt(page, form, user.email, PASSWORD, `10.66.1.1, ${ip}`)).toBe('locked')
  // Positivkontrolle: dieselbe Anmeldung von einer anderen IP klappt.
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('ok')

  // In der Datenbank steht nur der Hash, nicht die IP.
  const row = await prisma.loginThrottle.findUnique({ where: { key: throttleKey('login:ip', ip) } })
  expect(row?.count).toBeGreaterThanOrEqual(21)
  expect(await prisma.loginThrottle.count({ where: { key: { contains: ip } } })).toBe(0)
})

test('30 gleichzeitige Versuche: höchstens 10 erreichen die Passwortprüfung', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  const results = await Promise.all(
    Array.from({ length: 30 }, () => attempt(page, form, user.email, 'falsches Passwort', uniqueIp()))
  )
  const checked = results.filter(r => r === 'wrong').length
  expect(checked).toBeLessThanOrEqual(10)
  expect(checked).toBeGreaterThan(0)
  expect(results.filter(r => r === 'locked').length).toBe(30 - checked)
})

test('Nutzer-Login hat eigene Zähler und sperrt ebenfalls beim 11. Versuch', async ({ page }) => {
  const guest = await createGuestUser()
  const form = await loginForm(page, '/mein-konto/login')
  for (let i = 1; i <= 10; i++) {
    expect(await attempt(page, form, guest.email, 'falsches Passwort', uniqueIp()), `Versuch ${i}`).toBe('wrong')
  }
  expect(await attempt(page, form, guest.email, PASSWORD, uniqueIp())).toBe('locked')

  // Der Admin-Login derselben Adresse zählt getrennt (eigener scope) ...
  const admin = await createAccount('CREATOR', { email: guest.email })
  expect(await attempt(page, await loginForm(page), admin.email, PASSWORD, uniqueIp())).toBe('ok')
  // ... und ein anderes Nutzer-Konto ist nicht betroffen (Positivkontrolle).
  const other = await createGuestUser()
  expect(await attempt(page, form, other.email, PASSWORD, uniqueIp())).toBe('ok')
})

test('Passwort vergessen (Admin): neutrale Antwort, gedrosselt, Admins bekommen keinen Link', async ({ page }) => {
  const admin = await createAccount('ADMIN')
  const creator = await createAccount('CREATOR')
  const federated = await createAccount('CREATOR', { password: null })
  await page.goto('/admin/forgot-password')
  const form = await readForm(page, 'form:has(input[name="email"])')

  for (const email of [uniqueEmail('unbekannt'), admin.email, federated.email, creator.email]) {
    const response = await submitForm(page, form, { email })
    expect(locationOf(response)?.search, email).toBe('?sent=1')
  }
  expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).resetToken).toBeNull()
  expect((await prisma.user.findUniqueOrThrow({ where: { id: federated.id } })).resetToken).toBeNull()
  // Positivkontrolle: das Creator-Konto bekommt einen Link - gespeichert nur als SHA-256-Hash, 1 Stunde gültig.
  const withToken = await prisma.user.findUniqueOrThrow({ where: { id: creator.id } })
  expect(withToken.resetToken).toMatch(/^[0-9a-f]{64}$/)
  const minutes = (withToken.resetTokenExpiresAt!.getTime() - Date.now()) / 60_000
  expect(minutes).toBeGreaterThan(55)
  expect(minutes).toBeLessThanOrEqual(60)

  // Höchstens 3 Links pro Adresse und Stunde - danach bleibt der letzte Link bestehen.
  const target = await createAccount('CREATOR')
  const hashes = new Set<string | null>()
  for (let i = 1; i <= 5; i++) {
    const response = await submitForm(page, form, { email: target.email })
    expect(locationOf(response)?.search).toBe('?sent=1')
    hashes.add((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).resetToken)
  }
  expect(hashes.size).toBe(3)
})

test('Passwort vergessen (Nutzer): neutrale Antwort, höchstens 3 Links pro Stunde', async ({ page }) => {
  const guest = await createGuestUser()
  await page.goto('/mein-konto/forgot-password')
  const form = await readForm(page, 'form:has(input[name="email"])')

  const unknown = await submitForm(page, form, { email: uniqueEmail('unbekannt') })
  expect(locationOf(unknown)?.search).toBe('?sent=1')

  const hashes = new Set<string | null>()
  for (let i = 1; i <= 5; i++) {
    const response = await submitForm(page, form, { email: guest.email })
    expect(locationOf(response)?.search).toBe('?sent=1')
    hashes.add((await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })).resetToken)
  }
  expect(hashes.size).toBe(3)
  for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/)
})

test('Event-PIN: gesperrt nach 10 Fehlversuchen pro IP, auch mit richtiger PIN; andere IP unberührt', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { eventPin: '4711' })

  async function tryPin(target: Page, pin: string) {
    await target.getByPlaceholder('Event-PIN eingeben').fill(pin)
    await target.getByRole('button', { name: 'Freischalten' }).click()
  }

  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${event.slug}`)
  for (let i = 1; i <= 10; i++) {
    await tryPin(page, String(1000 + i))
    await expect(page.getByText('Falscher Code. Bitte versuche es erneut.')).toBeVisible()
    await page.reload()
  }
  await tryPin(page, '4711')
  await expect(page.getByText('Zu viele Versuche.')).toBeVisible()
  expect((await page.context().cookies()).some(c => c.name === `event_pin_${event.id}`)).toBe(false)

  // Positivkontrolle: von einer anderen IP schaltet dieselbe PIN frei.
  const other = await browser.newPage()
  await other.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await other.goto(`/${event.slug}`)
  await tryPin(other, '4711')
  await expect(other.getByRole('button', { name: 'Antwort absenden' })).toBeVisible()
  expect((await other.context().cookies()).some(c => c.name === `event_pin_${event.id}`)).toBe(true)
})
