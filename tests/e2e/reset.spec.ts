import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import {
  BASE_URL, PASSWORD, createAccount, createGuestUser, guestLogin, locationOf, login, prisma, readForm, sha256, submitForm
} from './helpers'

// Passwort-Reset per Einmal-Link (beide Login-Systeme). Ohne SMTP gibt es keine Mail zum
// Mitlesen: Der Test legt den Link wie requestPasswordReset an (nur der Hash in der Datenbank)
// und kennt deshalb den Klartext. Dass die Anforderung selbst einen Hash speichert, prüft
// throttle.spec.ts.

const NEW_PASSWORD = 'mein eigenes neues Passwort'

async function setNewPassword(page: Page, password: string) {
  await page.getByLabel('Neues Passwort').evaluate(el => el.removeAttribute('minlength'))
  await page.getByLabel('Neues Passwort').fill(password)
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
}

test('Admin-Reset: GET verbraucht nichts, schwaches Passwort abgelehnt, Link einmal nutzbar, Sitzungen beendet', async ({ page, browser }) => {
  const user = await createAccount('CREATOR')
  const token = 'reset-' + user.id
  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: sha256(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }
  })
  // Eine laufende Sitzung auf einem anderen Gerät (z.B. die eines Angreifers mit dem alten Passwort).
  const otherDevice = await browser.newPage()
  await login(otherDevice, user.email)
  await expect(otherDevice).toHaveURL(`${BASE_URL}/admin`)

  // Mail-Scanner rufen Links vorab auf: Ein GET darf den Link nicht verbrauchen.
  const link = `/admin/reset-password?token=${encodeURIComponent(token)}`
  await page.goto(link)
  await page.goto(link)
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resetToken).toBe(sha256(token))

  // Zu schwaches Passwort wird serverseitig abgelehnt, der Link bleibt gültig.
  await setNewPassword(page, 'kurz')
  await expect(page).toHaveURL(/error=weak/)
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resetToken).toBe(sha256(token))

  await setNewPassword(page, NEW_PASSWORD)
  await expect(page).toHaveURL(`${BASE_URL}/admin/login?reset=1`)
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  expect(updated.resetToken).toBeNull()
  expect(updated.resetTokenExpiresAt).toBeNull()
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
  await otherDevice.goto('/admin')
  await expect(otherDevice).toHaveURL(`${BASE_URL}/admin/login`)

  await login(page, user.email, NEW_PASSWORD)
  await expect(page).toHaveURL(`${BASE_URL}/admin`)

  // Zweite Nutzung desselben Links
  await page.goto(link)
  await expect(page.getByText('ungültig oder abgelaufen')).toBeVisible()
})

test('Admin-Reset: abgelaufener oder erfundener Link wird abgelehnt - auch beim direkten POST', async ({ page }) => {
  const user = await createAccount('CREATOR')
  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: sha256('abgelaufen-' + user.id), resetTokenExpiresAt: new Date(Date.now() - 1000) }
  })
  for (const token of ['abgelaufen-' + user.id, 'erfunden', sha256('abgelaufen-' + user.id)]) {
    await page.goto(`/admin/reset-password?token=${encodeURIComponent(token)}`)
    await expect(page.getByText('ungültig oder abgelaufen'), token).toBeVisible()
  }

  // Das Formular erscheint dann gar nicht - also mit einem gültigen Link lesen und den Token tauschen.
  const valid = 'gueltig-' + user.id
  const other = await createAccount('CREATOR')
  await prisma.user.update({ where: { id: other.id }, data: { resetToken: sha256(valid), resetTokenExpiresAt: new Date(Date.now() + 60_000) } })
  await page.goto(`/admin/reset-password?token=${valid}`)
  const form = await readForm(page, 'form:has(input[name="password"])')
  const denied = await submitForm(page, form, { token: 'abgelaufen-' + user.id, password: NEW_PASSWORD })
  expect(locationOf(denied)?.search).toBe('?error=invalid')
  expect(await bcrypt.compare(PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash!)).toBe(true)

  // Positivkontrolle: derselbe POST mit dem gültigen Token setzt das Passwort.
  const allowed = await submitForm(page, form, { password: NEW_PASSWORD })
  expect(locationOf(allowed)?.search).toBe('?reset=1')
  expect(await bcrypt.compare(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).passwordHash!)).toBe(true)
})

test('Nutzer-Reset: Link einmal nutzbar, beendet Sitzungen und bestätigt ein noch unbestätigtes Konto', async ({ page, browser }) => {
  const guest = await createGuestUser({ verified: false })
  const token = 'guest-reset-' + guest.id
  await prisma.guestUser.update({
    where: { id: guest.id },
    data: { resetToken: sha256(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }
  })
  await prisma.guestSession.create({ data: { token: sha256('alte-sitzung-' + guest.id), guestUserId: guest.id, expiresAt: new Date(Date.now() + 60_000) } })

  const link = `/mein-konto/reset-password?token=${encodeURIComponent(token)}`
  await page.goto(link)
  await page.goto(link)
  expect((await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })).resetToken).toBe(sha256(token))

  await setNewPassword(page, 'kurz')
  await expect(page).toHaveURL(/error=weak/)

  await setNewPassword(page, NEW_PASSWORD)
  await expect(page).toHaveURL(`${BASE_URL}/mein-konto/login?reset=1`)
  const updated = await prisma.guestUser.findUniqueOrThrow({ where: { id: guest.id } })
  expect(updated.resetToken).toBeNull()
  expect(updated.isVerified).toBe(true)
  expect(await prisma.guestSession.count({ where: { guestUserId: guest.id } })).toBe(0)

  const fresh = await browser.newPage()
  await guestLogin(fresh, guest.email, NEW_PASSWORD)
  await expect(fresh).toHaveURL(`${BASE_URL}/mein-konto`)

  await page.goto(link)
  await expect(page.getByText('ungültig oder abgelaufen')).toBeVisible()
})
