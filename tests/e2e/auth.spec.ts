import bcrypt from 'bcryptjs'
import { expect, test, type BrowserContext } from '@playwright/test'
import {
  BASE_URL, GUEST_SESSION_COOKIE, PASSWORD, SESSION_COOKIE, createAccount, createGuestUser, guestLogin, login,
  pageAlert, prisma, sha256, uniqueEmail
} from './helpers'

async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find(c => c.name === name)
}

test.describe('Admin-Login', () => {
  test('geschützte Seiten leiten ohne Sitzung zur Anmeldung', async ({ page }) => {
    for (const path of ['/admin', '/admin/account', '/admin/users', '/admin/create-user']) {
      await page.goto(path)
      await expect(page, path).toHaveURL(`${BASE_URL}/admin/login`)
    }
    // Positivkontrolle: mit Sitzung bleibt die Seite erreichbar.
    const user = await createAccount('CREATOR')
    await login(page, user.email)
    await page.goto('/admin/account')
    await expect(page).toHaveURL(`${BASE_URL}/admin/account`)
  })

  test('Session-Cookie: __Host-, HttpOnly, Secure, SameSite=Lax; in der Datenbank nur der Hash', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)

    const cookie = await cookieNamed(context, SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', domain: '127.0.0.1' })

    const sessions = await prisma.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].token).toBe(sha256(cookie!.value))
    expect(sessions[0].token).not.toBe(cookie!.value)
  })

  test('erfundenes oder abgelaufenes Cookie meldet nicht an', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    await login(page, user.email)
    const valid = (await cookieNamed(context, SESSION_COOKIE))!

    // Abgelaufen: dieselbe Sitzung, aber expiresAt in der Vergangenheit.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await page.goto('/admin')
    await expect(page).toHaveURL(`${BASE_URL}/admin/login`)

    // Erfunden bzw. der Hash statt des Klartexts (z.B. aus einem Datenbank-Leak).
    for (const value of ['erfunden', sha256(valid.value)]) {
      await context.addCookies([{ ...valid, value }])
      await page.goto('/admin')
      await expect(page, value).toHaveURL(`${BASE_URL}/admin/login`)
    }

    // Positivkontrolle: die wieder gültige Sitzung wirkt.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() + 60_000) } })
    await context.addCookies([valid])
    await page.goto('/admin')
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
  })

  test('Login erzeugt immer eine neue Sitzung (Session-Fixation)', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    await context.addCookies([
      { name: SESSION_COOKIE, value: 'vom-angreifer-gesetzt', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    ])
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    expect((await cookieNamed(context, SESSION_COOKIE))?.value).not.toBe('vom-angreifer-gesetzt')

    // Auch eine schon gültige Sitzung dieses Browsers wird beim erneuten Login ersetzt.
    const before = (await cookieNamed(context, SESSION_COOKIE))!.value
    await login(page, user.email)
    const after = (await cookieNamed(context, SESSION_COOKIE))!.value
    expect(after).not.toBe(before)
    expect(await prisma.session.count({ where: { token: sha256(before) } })).toBe(0)
  })

  test('Abmelden löscht die Sitzung auch in der Datenbank', async ({ page }) => {
    const user = await createAccount('CREATOR')
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/admin/login`)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    await page.goto('/admin')
    await expect(page).toHaveURL(`${BASE_URL}/admin/login`)
  })

  test('kein Open Redirect über next', async ({ page }) => {
    for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)', '/\t/evil.example']) {
      const user = await createAccount('CREATOR')
      await page.context().clearCookies()
      await page.goto(`/admin/login?next=${encodeURIComponent(next)}`)
      await page.getByLabel('E-Mail').fill(user.email)
      await page.getByLabel('Passwort').fill(PASSWORD)
      await page.getByRole('button', { name: 'Einloggen' }).click()
      await expect(page, next).toHaveURL(`${BASE_URL}/admin`)
    }
    // Positivkontrolle: ein interner Pfad wird übernommen.
    const user = await createAccount('CREATOR')
    await page.context().clearCookies()
    await page.goto(`/admin/login?next=${encodeURIComponent('/admin/account')}`)
    await page.getByLabel('E-Mail').fill(user.email)
    await page.getByLabel('Passwort').fill(PASSWORD)
    await page.getByRole('button', { name: 'Einloggen' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/admin/account`)
  })

  test('gleiche Fehlermeldung und vergleichbare Antwortzeit für bekannte und unbekannte Adressen', async ({ page }) => {
    const user = await createAccount('CREATOR')
    const withoutPassword = await createAccount('CREATOR', { password: null })
    const unknown = uniqueEmail('unbekannt')

    async function failedLogin(email: string): Promise<{ ms: number; text: string }> {
      const start = Date.now()
      await login(page, email, 'falsches Passwort!')
      await expect(page).toHaveURL(/error=1/)
      const ms = Date.now() - start
      return { ms, text: await page.getByRole('main').innerText() }
    }

    // Aufwärmen (erster Aufruf erzeugt den Wegwerf-Hash).
    await failedLogin(uniqueEmail('warmup'))

    const known: number[] = []
    const unknownTimes: number[] = []
    for (let i = 0; i < 3; i++) {
      const a = await failedLogin(user.email)
      const b = await failedLogin(unknown)
      const c = await failedLogin(withoutPassword.email)
      expect(a.text).toContain('E-Mail oder Passwort falsch.')
      expect(b.text).toBe(a.text)
      expect(c.text).toBe(a.text)
      known.push(a.ms)
      unknownTimes.push(b.ms, c.ms)
    }
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    // Unbekannte Adressen rechnen ebenfalls einen bcrypt-Hash - sie dürfen nicht deutlich schneller sein.
    expect(avg(unknownTimes)).toBeGreaterThan(avg(known) * 0.6)
  })

  test('Passwortwechsel beendet andere Sitzungen, die eigene bleibt', async ({ browser }) => {
    const user = await createAccount('CREATOR')
    const deviceA = await browser.newPage()
    const deviceB = await browser.newPage()
    await login(deviceA, user.email)
    await login(deviceB, user.email)
    await expect(deviceA).toHaveURL(`${BASE_URL}/admin`)
    await expect(deviceB).toHaveURL(`${BASE_URL}/admin`)

    await deviceA.goto('/admin/account')
    await deviceA.locator('#currentPassword').fill(PASSWORD)
    await deviceA.getByLabel('Neues Passwort').fill('ein neues sicheres Passwort')
    await deviceA.getByRole('button', { name: 'Passwort ändern' }).click()
    await expect(deviceA).toHaveURL(/passwordChanged=1/)

    await deviceA.goto('/admin')
    await expect(deviceA).toHaveURL(`${BASE_URL}/admin`)
    await deviceB.goto('/admin')
    await expect(deviceB).toHaveURL(`${BASE_URL}/admin/login`)

    await login(deviceB, user.email, 'ein neues sicheres Passwort')
    await expect(deviceB).toHaveURL(`${BASE_URL}/admin`)
  })

  test('Passwortwechsel verlangt das aktuelle Passwort und die Passwort-Regel', async ({ page }) => {
    const user = await createAccount('CREATOR')
    await login(page, user.email)
    await page.goto('/admin/account')
    await page.locator('#currentPassword').fill('falsch falsch falsch')
    await page.getByLabel('Neues Passwort').fill('ein neues sicheres Passwort')
    await page.getByRole('button', { name: 'Passwort ändern' }).click()
    await expect(page).toHaveURL(/error=wrongpassword/)

    // Serverseitige Regel greift auch, wenn das Browser-minLength umgangen wird.
    await page.locator('#currentPassword').fill(PASSWORD)
    await page.getByLabel('Neues Passwort').evaluate(el => el.removeAttribute('minlength'))
    await page.getByLabel('Neues Passwort').fill('kurz')
    await page.getByRole('button', { name: 'Passwort ändern' }).click()
    await expect(page).toHaveURL(/error=weak/)
    await expect(pageAlert(page)).toContainText('zu schwach')

    // Das alte Passwort gilt nach beiden Fehlversuchen unverändert.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await bcrypt.compare(PASSWORD, stored.passwordHash!)).toBe(true)
  })
})

test.describe('Nutzer-Login (Mein Konto)', () => {
  test('Gast-Cookie: __Host-, HttpOnly, Secure, SameSite=Lax; Hash in der Datenbank; lastLoginAt aktuell', async ({ page, context }) => {
    const guest = await createGuestUser()
    await prisma.guestUser.update({ where: { id: guest.id }, data: { lastLoginAt: new Date('2020-01-01') } })
    await guestLogin(page, guest.email)
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)

    const cookie = await cookieNamed(context, GUEST_SESSION_COOKIE)
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', domain: '127.0.0.1' })
    const sessions = await prisma.guestSession.findMany({ where: { guestUserId: guest.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].token).toBe(sha256(cookie!.value))
    const updated = await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })
    expect(Date.now() - updated.lastLoginAt.getTime()).toBeLessThan(60_000)
  })

  test('Gast-Login erzeugt immer eine neue Sitzung (Session-Fixation)', async ({ page, context }) => {
    const guest = await createGuestUser()
    await context.addCookies([
      { name: GUEST_SESSION_COOKIE, value: 'vom-angreifer-gesetzt', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    ])
    await guestLogin(page, guest.email)
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
    expect((await cookieNamed(context, GUEST_SESSION_COOKIE))?.value).not.toBe('vom-angreifer-gesetzt')
  })

  test('unbestätigtes Konto wird nicht angemeldet', async ({ page, context }) => {
    const unverified = await createGuestUser({ verified: false })
    await guestLogin(page, unverified.email)
    await expect(page).toHaveURL(/error=unverified/)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeUndefined()
    expect(await prisma.guestSession.count({ where: { guestUserId: unverified.id } })).toBe(0)

    // Positivkontrolle: nach der Bestätigung klappt derselbe Login.
    await prisma.guestUser.update({ where: { id: unverified.id }, data: { isVerified: true } })
    await guestLogin(page, unverified.email)
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
  })

  test('kein Open Redirect über next', async ({ page }) => {
    for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
      const guest = await createGuestUser()
      await page.context().clearCookies()
      await guestLogin(page, guest.email, PASSWORD, undefined, next)
      await expect(page, next).toHaveURL(`${BASE_URL}/mein-konto`)
    }
    // Positivkontrolle: ein interner Pfad wird übernommen.
    const guest = await createGuestUser()
    await page.context().clearCookies()
    await guestLogin(page, guest.email, PASSWORD, undefined, '/mein-konto/account')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto/account`)
  })

  test('Admin- und Gast-Sitzung sind nicht austauschbar', async ({ page, context }) => {
    const admin = await createAccount('ADMIN')
    const guest = await createGuestUser()
    await login(page, admin.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    const adminCookie = (await cookieNamed(context, SESSION_COOKIE))!

    // Die Admin-Sitzung öffnet "Mein Konto" nicht ...
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto/login`)
    // ... und ihr Token unter dem Gast-Cookie-Namen auch nicht.
    await context.addCookies([{ ...adminCookie, name: GUEST_SESSION_COOKIE }])
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto/login`)

    // Umgekehrt: ein Gast-Token unter dem Admin-Cookie-Namen öffnet /admin nicht.
    await context.clearCookies()
    await guestLogin(page, guest.email)
    const guestCookie = (await cookieNamed(context, GUEST_SESSION_COOKIE))!
    await context.addCookies([{ ...guestCookie, name: SESSION_COOKIE }])
    await page.goto('/admin')
    await expect(page).toHaveURL(`${BASE_URL}/admin/login`)

    // Positivkontrolle: das Gast-Cookie unter seinem eigenen Namen wirkt.
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
  })
})

test.describe('Konten-Verbund: Fehler beim Verknüpfen', () => {
  // Das state-Cookie des Empfängers (app/lib/suite-flow.ts) - ein falscher `state` lässt den Callback
  // sofort mit "sso" scheitern, ganz ohne echten Anbieter. Geprüft wird nur, WOHIN der Fehler führt.
  const STATE_COOKIE = '__Host-suite-state'
  const flowCookie = (mode: 'login' | 'link') =>
    `${STATE_COOKIE}=${encodeURIComponent(JSON.stringify({ state: 'richtig', issuer: 'https://anderes-tool.example.test', next: '/admin/account', mode }))}`

  async function callback(page: import('@playwright/test').Page, mode: 'login' | 'link', withSession: boolean) {
    const session = withSession ? (await page.context().cookies()).find(c => c.name === SESSION_COOKIE) : undefined
    const cookie = [flowCookie(mode), session ? `${SESSION_COOKIE}=${session.value}` : ''].filter(Boolean).join('; ')
    const response = await page.request.get('/api/suite/callback?assertion=x&state=falsch', { headers: { cookie }, maxRedirects: 0 })
    expect(response.status()).toBe(303)
    return new URL(response.headers()['location'], BASE_URL)
  }

  test('eingeloggt beim Verknüpfen: Meldung auf der Konto-Seite statt auf der Login-Seite', async ({ page }) => {
    const user = await createAccount('CREATOR')
    await login(page, user.email)

    const target = await callback(page, 'link', true)
    expect(`${target.pathname}${target.search}`).toBe('/admin/account?error=sso')
    await page.goto(`${target.pathname}${target.search}`)
    await expect(pageAlert(page)).toContainText('Die Anmeldung über das andere Tool ist fehlgeschlagen')

    // Kontrollen: ein normaler Login-Versuch und ein Verknüpfen ohne Sitzung landen weiter auf der Login-Seite.
    expect(`${(await callback(page, 'login', true)).pathname}`).toBe('/admin/login')
    const withoutSession = await callback(page, 'link', false)
    expect(`${withoutSession.pathname}${withoutSession.search}`).toBe('/admin/login?error=sso')
  })
})
