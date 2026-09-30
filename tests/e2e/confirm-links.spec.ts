import { randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { hashToken } from '../../app/lib/tokens'
import { createAccount, createEvent, createGuestUser, createRsvp, prisma, uniqueEmail } from './helpers'

// Bestätigungs-Links aus Mails (Double-Opt-In einer Zusage, Nutzerkonto bestätigen, E-Mail-Änderung
// für Admin- und Nutzerkonten). Link-Scanner von Mail-Anbietern rufen Links automatisch ab - teils
// als einfacher HTTP-Abruf, teils in einem echten Browser. Beides darf nichts bestätigen; erst der
// Klick auf den Button tut es (Positivkontrolle), und danach ist der Link verbraucht.

const token = () => randomBytes(24).toString('hex')

/** Wie ein Link-Scanner: einfacher Abruf (mit Weiterleitungen) und Aufruf in einem echten Browser. */
async function scan(request: APIRequestContext, page: Page, path: string) {
  const response = await request.get(path)
  expect(response.status(), path).toBe(200)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

test('Double-Opt-In einer Zusage (/verify): Aufruf bestätigt nichts, erst der Klick', async ({ page, request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { requireVerification: true })
  const { participant } = await createRsvp(event, { name: 'Opt-In-Gast' })
  const verifyToken = token()
  await prisma.participant.update({ where: { id: participant.id }, data: { email: uniqueEmail('optin'), verifyToken } })
  const path = `/verify?token=${verifyToken}`

  await scan(request, page, path)
  await scan(request, page, path)
  expect(await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).toMatchObject({ isVerified: false, verifyToken })
  await expect(page.getByRole('button', { name: 'Jetzt bestätigen' })).toBeVisible()

  // Positivkontrolle: der Klick bestätigt und zeigt das Ergebnis
  await page.getByRole('button', { name: 'Jetzt bestätigen' }).click()
  await expect(page.getByRole('heading', { name: /^Erfolgreich bestätigt!/ })).toBeVisible()
  await expect(page.getByText(event.title)).toBeVisible()
  expect(await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).toMatchObject({ isVerified: true, verifyToken: null })

  // Verbraucht: derselbe Link zeigt nur noch "ungültig"
  await page.goto(path)
  await expect(page.getByRole('heading', { name: /^Ungültiger Link/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jetzt bestätigen' })).toHaveCount(0)
})

test('/verify: zwei offene Seiten mit demselben Link bestätigen nur einmal', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { requireVerification: true })
  const { participant } = await createRsvp(event)
  const verifyToken = token()
  await prisma.participant.update({ where: { id: participant.id }, data: { verifyToken } })

  const [a, b] = await Promise.all([browser.newPage(), browser.newPage()])
  await Promise.all([a.goto(`/verify?token=${verifyToken}`), b.goto(`/verify?token=${verifyToken}`)])
  await a.getByRole('button', { name: 'Jetzt bestätigen' }).click()
  await expect(a.getByRole('heading', { name: /^Erfolgreich bestätigt!/ })).toBeVisible()
  await b.getByRole('button', { name: 'Jetzt bestätigen' }).click()
  await expect(b.getByRole('heading', { name: /^Ungültiger Link/ })).toBeVisible()
  await a.close()
  await b.close()
})

test('Nutzerkonto bestätigen (/mein-konto/verify): Aufruf bestätigt nichts, erst der Klick', async ({ page, request }) => {
  const guest = await createGuestUser({ verified: false })
  const plain = token()
  await prisma.guestUser.update({ where: { id: guest.id }, data: { verifyToken: hashToken(plain) } })
  const path = `/mein-konto/verify?token=${plain}&next=${encodeURIComponent('/reihe/x')}`

  await scan(request, page, path)
  await scan(request, page, path)
  expect(await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })).toMatchObject({ isVerified: false, verifyToken: hashToken(plain) })

  await page.getByRole('button', { name: 'Konto jetzt bestätigen' }).click()
  await expect(page.getByRole('heading', { name: /^Konto bestätigt!/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jetzt einloggen' })).toHaveAttribute('href', `/mein-konto/login?next=${encodeURIComponent('/reihe/x')}`)
  expect(await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })).toMatchObject({ isVerified: true, verifyToken: null })

  await page.goto(path)
  await expect(page.getByRole('heading', { name: /^Ungültiger Link/ })).toBeVisible()
})

for (const side of ['admin', 'mein-konto'] as const) {
  test(`E-Mail-Änderung (/${side}/confirm-email): Aufruf ändert nichts, erst der Klick`, async ({ page, request }) => {
    const plain = token()
    const newEmail = uniqueEmail('neu')
    const expires = new Date(Date.now() + 60 * 60 * 1000)
    const pending = { pendingEmail: newEmail, emailChangeToken: hashToken(plain), emailChangeTokenExpiresAt: expires }
    const read = side === 'admin'
      ? await (async () => {
        const user = await createAccount('CREATOR')
        await prisma.user.update({ where: { id: user.id }, data: pending })
        return { oldEmail: user.email, get: () => prisma.user.findUniqueOrThrow({ where: { id: user.id } }) }
      })()
      : await (async () => {
        const guest = await createGuestUser()
        await prisma.guestUser.update({ where: { id: guest.id }, data: pending })
        return { oldEmail: guest.email, get: () => prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } }) }
      })()
    const path = `/${side}/confirm-email?token=${plain}`

    await scan(request, page, path)
    await scan(request, page, path)
    expect(await read.get()).toMatchObject({ email: read.oldEmail, pendingEmail: newEmail, emailChangeToken: hashToken(plain) })
    await expect(page.getByText(newEmail)).toBeVisible()

    await page.getByRole('button', { name: 'Neue Adresse jetzt bestätigen' }).click()
    await expect(page.getByRole('heading', { name: /^E-Mail-Adresse geändert!/ })).toBeVisible()
    expect(await read.get()).toMatchObject({ email: newEmail, pendingEmail: null, emailChangeToken: null })

    await page.goto(path)
    await expect(page.getByRole('heading', { name: /^Ungültiger Link/ })).toBeVisible()
  })

  test(`E-Mail-Änderung (/${side}/confirm-email): abgelaufener Link zeigt keinen Button`, async ({ page }) => {
    const plain = token()
    const data = { pendingEmail: uniqueEmail('alt'), emailChangeToken: hashToken(plain), emailChangeTokenExpiresAt: new Date(Date.now() - 1000) }
    if (side === 'admin') await prisma.user.update({ where: { id: (await createAccount('CREATOR')).id }, data })
    else await prisma.guestUser.update({ where: { id: (await createGuestUser()).id }, data })
    await page.goto(`/${side}/confirm-email?token=${plain}`)
    await expect(page.getByRole('heading', { name: /^Ungültiger Link/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /bestätigen/ })).toHaveCount(0)
  })
}
