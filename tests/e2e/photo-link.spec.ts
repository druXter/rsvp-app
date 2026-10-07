import { expect, test } from '@playwright/test'
import { createAccount, createEvent, createRsvp, createSeries, createTermin, login, prisma, readForm, submitForm } from './helpers'

// Foto-Link (Event.photoUrl, app/lib/photo-link.ts, Idee Q3 der Suite): Speichern im Termin-Formular (nur
// http(s)) und Anzeige für Gäste mit Zusage ab dem Ende des Termins.

const ALBUM = 'https://fotos.example.test/s/sommerfest'
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000)
const photoLink = (page: import('@playwright/test').Page) => page.getByRole('link', { name: /Fotos ansehen/ })

test('Foto-Link im Termin-Formular speichern, ändern und entfernen; nur http(s)', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = () => readForm(page, 'form:has(input[name="photoUrl"])')

  await submitForm(page, await form(), { photoUrl: ALBUM })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).photoUrl).toBe(ALBUM)
  await page.reload()
  await expect(page.locator('input[name="photoUrl"]')).toHaveValue(ALBUM)

  // Am Browser-Check (type=url) vorbei: javascript: wird serverseitig abgelehnt, der alte Link bleibt
  await submitForm(page, await form(), { photoUrl: 'javascript:alert(1)' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).photoUrl).toBe(ALBUM)

  await submitForm(page, await form(), { photoUrl: '' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).photoUrl).toBeNull()
})

test('Gäste mit Zusage sehen den Foto-Link ab dem Ende des Termins, andere nie', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const past = await createEvent(owner, { date: hoursAgo(10), duration: 4, photoUrl: ALBUM })
  const running = await createEvent(owner, { date: hoursAgo(1), duration: 4, photoUrl: ALBUM })

  const attending = await createRsvp(past, { isAttending: true })
  await page.goto(`/${past.slug}?token=${attending.participant.editToken}`)
  await expect(photoLink(page)).toHaveAttribute('href', ALBUM)
  await expect(photoLink(page)).toHaveAttribute('rel', 'noopener noreferrer')

  for (const [label, rsvp] of [
    ['Absage', await createRsvp(past, { isAttending: false })],
    ['Warteliste', await createRsvp(past, { isAttending: true, isOnWaitlist: true })],
    ['läuft noch', await createRsvp(running, { isAttending: true })]
  ] as const) {
    const slug = rsvp.rsvp.eventId === past.id ? past.slug : running.slug
    await page.goto(`/${slug}?token=${rsvp.participant.editToken}`)
    await expect(page.getByLabel('Dein Name'), label).toBeVisible()
    await expect(photoLink(page), label).toHaveCount(0)
  }

  // Ohne persönlichen Link (wer nur die Eventseite kennt): nichts
  await page.goto(`/${past.slug}`)
  await expect(photoLink(page)).toHaveCount(0)
})

test('auch für Termine einer Reihe', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const termin = await createTermin(series, { date: hoursAgo(10), duration: 4, photoUrl: ALBUM })
  const { participant } = await createRsvp(termin, { isAttending: true })
  await page.goto(`/reihe/${series.slug}/${termin.slug}?token=${participant.editToken}`)
  await expect(photoLink(page)).toHaveAttribute('href', ALBUM)
})
