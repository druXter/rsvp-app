import { expect, test } from '@playwright/test'
import { createAccount, createGuestUser, createSeries, createTermin, guestLogin, login, prisma } from './helpers'

// Reihen-Termine verschwinden 48 Stunden nach Beginn aus den Listen (isArchived in
// app/lib/event-date.ts): Verwaltung -> eingeklapptes Archiv, Nutzer -> ausgeblendet.

const HOUR = 60 * 60 * 1000

async function seriesWithTermine() {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const upcoming = await createTermin(series, { date: new Date(Date.now() + 24 * HOUR) })
  const recent = await createTermin(series, { date: new Date(Date.now() - 24 * HOUR) })
  const old = await createTermin(series, { date: new Date(Date.now() - 72 * HOUR) })
  const pending = await createTermin(series, { date: new Date(Date.now() - 72 * HOUR), datePending: true })
  return { owner, series, upcoming, recent, old, pending }
}

test('Verwaltung: alte Termine landen im eingeklappten Archiv der Reihe', async ({ page }) => {
  const { owner, series, upcoming, recent, old, pending } = await seriesWithTermine()
  await login(page, owner.email)

  for (const path of [`/admin/series/${series.id}`, '/admin']) {
    await page.goto(path)
    for (const t of [upcoming, recent, pending]) await expect(page.getByText(t.title)).toBeVisible()
    await expect(page.getByText(old.title)).toBeHidden()

    await page.locator('summary', { hasText: '🗄️ Archiv (1 vergangener Termin)' }).click()
    await expect(page.getByText(old.title)).toBeVisible()
  }
})

test('Nutzer: alte Termine fehlen in Reihen-Übersicht und Mein Konto, bleiben aber erreichbar', async ({ page }) => {
  const { series, upcoming, recent, old, pending } = await seriesWithTermine()
  const guest = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId: series.id } })

  await page.goto(`/reihe/${series.slug}`)
  for (const t of [upcoming, recent, pending]) await expect(page.getByText(t.title)).toBeVisible()
  await expect(page.getByText(old.title)).toHaveCount(0)

  await guestLogin(page, guest.email)
  await page.goto('/mein-konto')
  for (const t of [upcoming, recent, pending]) await expect(page.getByText(t.title)).toBeVisible()
  await expect(page.getByText(old.title)).toHaveCount(0)

  // Der persönliche Link aus der Mail führt weiterhin zum Termin.
  const response = await page.goto(`/reihe/${series.slug}/${old.slug}`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Antwort absenden' })).toBeVisible()
})
