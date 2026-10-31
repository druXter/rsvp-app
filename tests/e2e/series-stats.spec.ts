import { expect, test } from '@playwright/test'
import { BASE_URL, cookieHeader, createAccount, createRsvp, createSeries, createTermin, login, prisma } from './helpers'

// Auswertung einer Reihe (Idee L31, app/lib/series-stats.ts): Reiter „Auswertung“ und CSV, nur mit Zugriff auf die Reihe.

const DAY = 24 * 60 * 60 * 1000

test('Reiter und CSV: Verlauf, Stammgäste, Gefehlt - für Owner und Moderator*innen der Reihe, sonst 404', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const first = await createTermin(series, { title: 'Erster Abend', date: new Date(Date.now() - 14 * DAY), enableCheckin: true })
  const second = await createTermin(series, { title: 'Zweiter Abend', date: new Date(Date.now() - 7 * DAY), enableCheckin: true })
  await createTermin(series, { title: 'Nächster Abend', date: new Date(Date.now() + 7 * DAY) })
  const stamm = await createRsvp(first, { name: 'Stammgast Sina' })
  await prisma.rsvp.update({ where: { id: stamm.rsvp.id }, data: { hasAttended: true } })
  const again = await createRsvp(second, { participantId: stamm.participant.id })
  await prisma.rsvp.update({ where: { id: again.rsvp.id }, data: { hasAttended: true } })
  // Sagt zu und kommt nicht
  await createRsvp(second, { name: 'Fehlt Felix' })

  const context = await browser.newContext({ baseURL: BASE_URL })
  const page = await context.newPage()
  await login(page, owner.email)
  await page.goto(`/admin/series/${series.id}`)
  await page.getByRole('link', { name: 'Auswertung' }).click()
  await expect(page.getByTestId('stat-past')).toContainText('2')
  await expect(page.getByTestId('stat-rate')).toContainText('67 %')
  await expect(page.getByTestId('stats-termin')).toHaveCount(3)
  await expect(page.getByTestId('stats-termin').last()).toContainText('anstehend')
  const sina = page.getByTestId('stats-person').filter({ hasText: 'Stammgast Sina' })
  await expect(sina).toContainText('Stammgast')
  await expect(sina).toContainText('2 / 2')
  await expect(page.getByTestId('stats-person').filter({ hasText: 'Fehlt Felix' })).not.toContainText('Stammgast')

  const headers = await cookieHeader(context)
  const personen = await page.request.get(`/api/export/reihe?seriesId=${series.id}&art=personen`, { headers })
  expect(personen.status()).toBe(200)
  const text = await personen.text()
  expect(text).toContain('Stammgast Sina;persönlicher Link;2;2;2;0;100 %;0;0;ja')
  expect(text).toContain('Fehlt Felix;persönlicher Link;1;2;0;1;0 %;0;0;nein')
  // Keine Kontaktdaten in der Auswertung
  expect(text).not.toContain('@')
  const termine = await page.request.get(`/api/export/reihe?seriesId=${series.id}&art=termine`, { headers })
  expect(await termine.text()).toContain('Zweiter Abend')
  await context.close()

  // Moderator*in der Reihe sieht die Auswertung (Positivkontrolle), ein fremdes Konto nicht - weder Reiter noch CSV
  const moderator = await createAccount('MODERATOR')
  await prisma.resourceAccess.create({ data: { userId: moderator.id, seriesId: series.id } })
  const stranger = await createAccount('CREATOR')
  for (const [account, allowed] of [[moderator, true], [stranger, false]] as const) {
    const ctx = await browser.newContext({ baseURL: BASE_URL })
    const p = await ctx.newPage()
    await login(p, account.email)
    const response = await p.goto(`/admin/series/${series.id}/auswertung`)
    expect(response!.status()).toBe(allowed ? 200 : 404)
    const csv = await p.request.get(`/api/export/reihe?seriesId=${series.id}&art=personen`, { headers: await cookieHeader(ctx) })
    expect(csv.status()).toBe(allowed ? 200 : 404)
    if (allowed) expect(await csv.text()).toContain('Stammgast Sina')
    await ctx.close()
  }
})
