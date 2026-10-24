import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  BASE_URL, GUEST_SESSION_COOKIE, PASSWORD, SESSION_COOKIE, createAccount, createGuestUser, guestLogin, login, logout,
  locationOf, pageAlert, prisma, readForm, submitForm
} from './helpers'

// Verknüpfung Verwaltungskonto → Teilnehmendenkonto (User.linkedGuestUserId, linkGuestAccount in app/admin/actions.ts).

async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find(c => c.name === name)
}

async function linkOnAccountPage(page: Page, guestEmail: string, guestPassword = PASSWORD) {
  await page.goto('/admin/account')
  await page.getByLabel('E-Mail des Teilnehmendenkontos').fill(guestEmail)
  await page.getByLabel('Passwort des Teilnehmendenkontos').fill(guestPassword)
  await page.getByRole('button', { name: 'Verknüpfen' }).click()
  await page.waitForURL(url => url.searchParams.has('guestLinked') || url.searchParams.has('error'))
}

async function linkedGuestId(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).linkedGuestUserId
}

test.describe('Teilnehmendenkonto verknüpfen', () => {
  test('nur mit dem Passwort des Teilnehmendenkontos; danach meldet der Verwaltungs-Login mit an', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await login(page, user.email)

    // Falsches Passwort und unbekannte Adresse: dieselbe Meldung, keine Verknüpfung.
    await linkOnAccountPage(page, guest.email, 'ein falsches Passwort!')
    await expect(page).toHaveURL(/error=guestlink-failed/)
    await linkOnAccountPage(page, 'niemand@example.test')
    await expect(page).toHaveURL(/error=guestlink-failed/)
    expect(await linkedGuestId(user.id)).toBeNull()

    // Positivkontrolle: mit dem richtigen Passwort klappt es, und "Mein Konto" ist sofort offen.
    await linkOnAccountPage(page, guest.email)
    await expect(page).toHaveURL(/guestLinked=1/)
    expect(await linkedGuestId(user.id)).toBe(guest.id)
    await expect(page.getByText(`Verknüpft mit ${guest.email}`)).toBeVisible()

    // Frischer Browser: der Verwaltungs-Login öffnet beide Bereiche.
    await context.clearCookies()
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeDefined()
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
    const updated = await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })
    expect(Date.now() - updated.lastLoginAt.getTime()).toBeLessThan(60_000)
  })

  test('die Gegenrichtung gibt es nicht: der Gast-Login öffnet die Verwaltung nie', async ({ page, context }) => {
    const user = await createAccount('ADMIN')
    const guest = await createGuestUser()
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })

    await guestLogin(page, guest.email)
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
    expect(await cookieNamed(context, SESSION_COOKIE)).toBeUndefined()
    await page.goto('/admin')
    await expect(page).toHaveURL(`${BASE_URL}/admin/login`)

    // Positivkontrolle: derselbe Browser kommt mit dem Verwaltungs-Login hinein.
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
  })

  test('unbestätigtes Teilnehmendenkonto: weder verknüpfbar noch mit angemeldet', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser({ verified: false })
    await login(page, user.email)
    await linkOnAccountPage(page, guest.email)
    await expect(page).toHaveURL(/error=guestlink-unverified/)
    expect(await linkedGuestId(user.id)).toBeNull()

    // Auch eine (z.B. vor einer E-Mail-Änderung entstandene) Verknüpfung meldet ein unbestätigtes Konto nicht an.
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })
    await context.clearCookies()
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeUndefined()

    // Positivkontrolle: nach der Bestätigung wird es mit angemeldet.
    await prisma.guestUser.update({ where: { id: guest.id }, data: { isVerified: true } })
    await context.clearCookies()
    await login(page, user.email)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeDefined()
  })

  test('ein Teilnehmendenkonto gehört höchstens zu einem Verwaltungskonto', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const other = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await prisma.user.update({ where: { id: owner.id }, data: { linkedGuestUserId: guest.id } })

    await login(page, other.email)
    await linkOnAccountPage(page, guest.email)
    await expect(page).toHaveURL(/error=guestlink-taken/)
    await expect(pageAlert(page)).toContainText('bereits mit einem anderen Verwaltungskonto')
    expect(await linkedGuestId(other.id)).toBeNull()
    expect(await linkedGuestId(owner.id)).toBe(guest.id)

    // Positivkontrolle: ein freies Teilnehmendenkonto lässt sich verknüpfen.
    const free = await createGuestUser()
    await linkOnAccountPage(page, free.email)
    await expect(page).toHaveURL(/guestLinked=1/)
    expect(await linkedGuestId(other.id)).toBe(free.id)
  })

  test('Verknüpfen zählt gegen die Drosselung des Gast-Logins', async ({ page }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await login(page, user.email)
    await page.goto('/admin/account')
    const form = await readForm(page, 'form:has(input[name="guestPassword"])')

    // 10 Fehlversuche pro Adresse (loginRules, Bereich guest-login) - danach ist auch das richtige Passwort gesperrt.
    for (let i = 0; i < 10; i++) {
      const failed = await submitForm(page, form, { guestEmail: guest.email, guestPassword: `falsch-${i}-falsch` })
      expect(locationOf(failed)?.search).toContain('guestlink-failed')
    }
    const locked = await submitForm(page, form, { guestEmail: guest.email, guestPassword: PASSWORD })
    expect(locationOf(locked)?.search).toContain('guestlink-locked')
    expect(await linkedGuestId(user.id)).toBeNull()

    // Positivkontrolle: dieselbe Anfrage für ein anderes Konto geht durch.
    const fresh = await createGuestUser()
    const ok = await submitForm(page, form, { guestEmail: fresh.email, guestPassword: PASSWORD })
    expect(locationOf(ok)?.search).toContain('guestLinked=1')
    expect(await linkedGuestId(user.id)).toBe(fresh.id)
  })

  test('Abmelden aus der Verwaltung beendet die verknüpfte Gast-Sitzung, aber keine fremde', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })

    await login(page, user.email)
    await logout(page)
    await page.waitForURL(/\/admin\/login/)
    expect(await prisma.guestSession.count({ where: { guestUserId: guest.id } })).toBe(0)
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto/login`)

    // Fremdes Teilnehmendenkonto im selben Browser: bleibt beim Abmelden angemeldet.
    const stranger = await createGuestUser()
    await guestLogin(page, stranger.email)
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: null } })
    await login(page, user.email)
    await logout(page)
    await page.waitForURL(/\/admin\/login/)
    await page.goto('/mein-konto')
    await expect(page).toHaveURL(`${BASE_URL}/mein-konto`)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeDefined()
  })

  test('das Teilnehmendenkonto kann die Verknüpfung selbst lösen', async ({ page, context }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })

    await guestLogin(page, guest.email)
    await page.goto('/mein-konto/account')
    await expect(page.getByText(user.email)).toBeVisible()
    await page.getByRole('button', { name: 'Verknüpfung lösen' }).click()
    await page.waitForURL(/adminUnlinked=1/)
    expect(await linkedGuestId(user.id)).toBeNull()

    // Danach meldet der Verwaltungs-Login nicht mehr mit an.
    await context.clearCookies()
    await login(page, user.email)
    await expect(page).toHaveURL(`${BASE_URL}/admin`)
    expect(await cookieNamed(context, GUEST_SESSION_COOKIE)).toBeUndefined()
  })

  test('Lösen aus der Verwaltung, und Löschen des Teilnehmendenkontos entfernt die Verknüpfung', async ({ page }) => {
    const user = await createAccount('CREATOR')
    const guest = await createGuestUser()
    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })

    await login(page, user.email)
    await page.goto('/admin/account')
    await page.getByRole('button', { name: 'Verknüpfung lösen' }).click()
    await page.waitForURL(/guestUnlinked=1/)
    expect(await linkedGuestId(user.id)).toBeNull()

    await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guest.id } })
    // Wie deleteGuestAccount: erst die Sitzungen (der Verwaltungs-Login oben hat eine mit geöffnet), dann das Konto.
    await prisma.guestSession.deleteMany({ where: { guestUserId: guest.id } })
    await prisma.guestUser.delete({ where: { id: guest.id } })
    expect(await linkedGuestId(user.id)).toBeNull()
  })
})
