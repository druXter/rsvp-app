import { expect, test } from '@playwright/test'
import { cookieHeader, createAccount, createEvent, createRsvp, login, prisma, unique } from './helpers'
import { markEndpointExpired } from '../../app/lib/push-subscriptions'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Lebenszyklus der Push-Abos (app/lib/push-subscriptions.ts): Stand für die Schalter (/api/push/status), Ersetzen
// eines abgelaufenen oder vom Browser erneuerten Abos (/api/push/resubscribe), Markieren statt Löschen bei 404/410
// und Aufräumen. Den Versand selbst gibt es in den Tests nicht (keine VAPID-Schlüssel).

const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${unique()}`
const browserSub = (url: string) => ({ endpoint: url, keys: KEYS })

async function guestWithPush(url: string, options: { expiredAt?: Date } = {}) {
  const event = await createEvent(await createAccount())
  const { participant } = await createRsvp(event)
  await prisma.participantPushSubscription.create({ data: { endpoint: url, ...KEYS, participantId: participant.id, expiredAt: options.expiredAt ?? null } })
  return participant
}

test('Status für Gäste: nur das eigene Abo zählt, abgelaufen wird gemeldet', async ({ request }) => {
  const url = endpoint()
  const owner = await guestWithPush(url)
  const other = (await createRsvp(await createEvent(await createAccount()))).participant
  const status = async (editToken: unknown, subscription: unknown = browserSub(url)) =>
    (await (await request.post('/api/push/status', { data: { editToken, subscription } })).json()).status

  expect(await status(owner.editToken)).toBe('active')
  // Fremder Gast mit demselben Gerät, unbekannter Link, ungültige Eingaben: none
  expect(await status(other.editToken)).toBe('none')
  expect(await status('unbekannt')).toBe('none')
  expect(await status(owner.editToken, { endpoint: 'http://127.0.0.1/x', keys: KEYS })).toBe('none')
  expect((await (await request.post('/api/push/status', { data: 'null' })).json()).status).toBe('none')

  await markEndpointExpired(url)
  expect(await status(owner.editToken)).toBe('expired')
})

test('Status für die Verwaltung: nur mit Sitzung und nur das Abo des eigenen Kontos', async ({ page, browser, request }) => {
  const admin = await createAccount('ADMIN')
  const url = endpoint()
  await prisma.pushSubscription.create({ data: { endpoint: url, ...KEYS, userId: admin.id } })

  expect((await (await request.post('/api/push/status', { data: { subscription: browserSub(url) } })).json()).status).toBe('none')
  await login(page, admin.email)
  // Positivkontrolle: mit der Sitzung des Kontos aktiv
  expect((await (await page.request.post('/api/push/status', { data: { subscription: browserSub(url) }, headers: await cookieHeader(page.context()) })).json()).status).toBe('active')
  const other = await createAccount()
  const otherPage = await browser.newPage()
  await login(otherPage, other.email)
  expect((await (await otherPage.request.post('/api/push/status', { data: { subscription: browserSub(url) }, headers: await cookieHeader(otherPage.context()) })).json()).status).toBe('none')
  await otherPage.close()
})

test('404/410 markiert das Abo in beiden Tabellen als abgelaufen, ein neues ersetzt es überall', async ({ request }) => {
  const old = endpoint()
  const guestA = await guestWithPush(old)
  const guestB = await guestWithPush(old)
  const admin = await createAccount('ADMIN')
  await prisma.pushSubscription.create({ data: { endpoint: old, ...KEYS, userId: admin.id } })

  await markEndpointExpired(old)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: old, expiredAt: { not: null } } })).toBe(2)
  expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: old } })).expiredAt).not.toBeNull()

  // Unbekannter alter Endpoint oder neues Abo außerhalb der Push-Dienste: nichts passiert
  const fresh = endpoint()
  for (const data of [
    { oldEndpoint: endpoint(), subscription: browserSub(fresh) },
    { oldEndpoint: old, subscription: browserSub('https://127.0.0.1/intern') },
    { oldEndpoint: old }
  ]) {
    expect((await request.post('/api/push/resubscribe', { data })).status()).toBe(204)
  }
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: fresh } })).toBe(0)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: old } })).toBe(2)

  // Positivkontrolle: das echte neue Abo ersetzt das alte für beide Gäste und das Konto, wieder aktiv
  expect((await request.post('/api/push/resubscribe', { data: { oldEndpoint: old, subscription: browserSub(fresh) } })).status()).toBe(204)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: old } })).toBe(0)
  for (const guest of [guestA, guestB]) {
    const row = await prisma.participantPushSubscription.findUniqueOrThrow({ where: { participantId_endpoint: { participantId: guest.id, endpoint: fresh } } })
    expect(row.expiredAt).toBeNull()
  }
  const adminRow = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: fresh } })
  expect(adminRow.userId).toBe(admin.id)
  expect(adminRow.expiredAt).toBeNull()
  expect((await (await request.post('/api/push/status', { data: { editToken: guestA.editToken, subscription: browserSub(fresh) } })).json()).status).toBe('active')
})

test('Ein Gerät kann für mehrere Gäste abonniert sein, ohne dass sich die Abos verdrängen', async () => {
  const url = endpoint()
  const first = await guestWithPush(url)
  const second = await guestWithPush(url)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: url } })).toBe(2)
  expect(await prisma.participantPushSubscription.count({ where: { participantId: { in: [first.id, second.id] } } })).toBe(2)
})

test('Cleanup löscht Abos, die seit mehr als 90 Tagen abgelaufen sind', async ({ request }) => {
  const day = 24 * 60 * 60 * 1000
  const old = endpoint()
  const recent = endpoint()
  const active = endpoint()
  await guestWithPush(old, { expiredAt: new Date(Date.now() - 91 * day) })
  await guestWithPush(recent, { expiredAt: new Date(Date.now() - 10 * day) })
  await guestWithPush(active)
  const admin = await createAccount('ADMIN')
  const adminOld = endpoint()
  await prisma.pushSubscription.create({ data: { endpoint: adminOld, ...KEYS, userId: admin.id, expiredAt: new Date(Date.now() - 91 * day) } })

  expect((await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).status()).toBe(200)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: old } })).toBe(0)
  expect(await prisma.pushSubscription.count({ where: { endpoint: adminOld } })).toBe(0)
  // Positivkontrollen: kürzlich abgelaufen und aktiv bleiben
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: recent } })).toBe(1)
  expect(await prisma.participantPushSubscription.count({ where: { endpoint: active } })).toBe(1)
})
