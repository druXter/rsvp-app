import { expect, test } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin, prisma } from './helpers'

const DAY = 24 * 60 * 60 * 1000

test('beide Cron-Endpunkte lehnen fehlendes, leeres und falsches Secret ab', async ({ request }) => {
  for (const route of ['/api/cron/cleanup', '/api/cron/reminders']) {
    for (const query of ['', '?secret=', '?secret=falsch', `?secret=${TEST_CRON_SECRET}x`, `?secret=${TEST_CRON_SECRET.slice(0, -1)}`]) {
      const response = await request.get(`${route}${query}`)
      expect(response.status(), `${route}${query}`).toBe(401)
    }
  }
})

test('Aufräumen: alte Events weg, aktive Reihen-Teilnehmende bleiben, inaktive Nutzer-Konten weg', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const oldTermin = await createTermin(series, { date: new Date(Date.now() - 19 * 30 * DAY) })
  const newTermin = await createTermin(series)
  // Teilnehmende mit einer alten UND einer neuen Antwort bleiben, nur die alte Antwort geht.
  const { participant: regular } = await createRsvp(oldTermin)
  await createRsvp(newTermin, { participantId: regular.id })
  // Nur beim alten Termin dabei: wird mitsamt Profil gelöscht.
  const { participant: onlyOld } = await createRsvp(oldTermin)
  const oldStandalone = await createEvent(owner, { date: new Date(Date.now() - 19 * 30 * DAY) })
  const recentPast = await createEvent(owner, { date: new Date(Date.now() - 17 * 30 * DAY) })

  const inactive = await createGuestUser()
  const active = await createGuestUser()
  await prisma.guestUser.update({ where: { id: inactive.id }, data: { lastLoginAt: new Date(Date.now() - 3 * 365 * DAY) } })
  await prisma.guestUserSeries.create({ data: { guestUserId: inactive.id, seriesId: series.id } })
  await createApiToken(inactive)
  await createRsvp(newTermin, { guestUserId: inactive.id })
  // Admin-seitige Konten verschwinden nie automatisch.
  const oldAdminAccount = await createAccount('CREATOR')

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)

  expect(await prisma.event.findUnique({ where: { id: oldTermin.id } })).toBeNull()
  expect(await prisma.event.findUnique({ where: { id: oldStandalone.id } })).toBeNull()
  expect(await prisma.event.findUnique({ where: { id: recentPast.id } })).not.toBeNull()
  expect(await prisma.event.findUnique({ where: { id: newTermin.id } })).not.toBeNull()

  expect(await prisma.participant.findUnique({ where: { id: regular.id } })).not.toBeNull()
  expect(await prisma.rsvp.count({ where: { participantId: regular.id } })).toBe(1)
  expect(await prisma.participant.findUnique({ where: { id: onlyOld.id } })).toBeNull()

  expect(await prisma.guestUser.findUnique({ where: { id: inactive.id } })).toBeNull()
  expect(await prisma.guestApiToken.count({ where: { guestUserId: inactive.id } })).toBe(0)
  expect(await prisma.participant.count({ where: { guestUserId: inactive.id } })).toBe(0)
  expect(await prisma.guestUser.findUnique({ where: { id: active.id } })).not.toBeNull()
  expect(await prisma.user.findUnique({ where: { id: oldAdminAccount.id } })).not.toBeNull()
})

test('Erinnerungen: nur fällige Events mit Automatik, danach nie ein zweites Mal', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const due = await createEvent(owner, { autoReminder: true, reminderDays: 7, date: new Date(Date.now() + 3 * DAY) })
  const notYet = await createEvent(owner, { autoReminder: true, reminderDays: 7, date: new Date(Date.now() + 30 * DAY) })
  const manual = await createEvent(owner, { autoReminder: false, reminderDays: 7, date: new Date(Date.now() + 3 * DAY) })

  const first = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(first.status()).toBe(200)
  const reminderSent = async (id: string) => (await prisma.event.findUniqueOrThrow({ where: { id } })).reminderSent
  expect(await reminderSent(due.id)).toBe(true)
  expect(await reminderSent(notYet.id)).toBe(false)
  expect(await reminderSent(manual.id)).toBe(false)

  // Idempotent: ein zweiter Lauf fasst das bereits erledigte Event nicht mehr an.
  const second = await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect(second.status()).toBe(200)
  expect(await second.json()).toEqual({ success: true, processedEvents: 0 })
})
