import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { TEST_ABSTIMMUNGSTOOL_BASE_URL, TEST_POLL_SECRET } from '../../playwright.config'
import {
  createAccount, createEvent, createRsvp, decodeCouplingToken, locationOf, login, prisma, readForm, signCouplingToken, submitForm, unique
} from './helpers'

// Sitzung im Abstimmungstool (Idee L7, app/lib/assembly.ts): Link im Termin-Formular (mit Meldung ans
// Abstimmungstool), "Zur Sitzung" mit Beitritts-Nachweis (/api/assembly-link) und die Anwesenheit, die das
// Abstimmungstool abfragt (/api/assembly/roster). Jeder abgelehnte Fall hat eine positive Gegenprobe.

const assemblyId = () => `cm${unique().replace(/[^a-z0-9]/gi, '')}`
const assemblyUrl = (id: string) => `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/sitzung/${id}`
const sub = (id: string, rsvpId: string) => createHmac('sha256', TEST_POLL_SECRET).update(`assembly-sub\u0000${id}\u0000${rsvpId}`).digest('base64url')
const exp = () => Math.floor(Date.now() / 1000) + 300

/** Prüft die Signatur einer Antwort wie das Abstimmungstool und gibt die Payload zurück. */
function verified(token: string): Record<string, unknown> {
  const [payloadPart, signature] = token.split('.')
  expect(createHmac('sha256', TEST_POLL_SECRET).update(payloadPart).digest('base64url')).toBe(signature)
  return decodeCouplingToken(token)
}

test.describe('Link im Termin-Formular', () => {
  let tool: Server
  const received: { path: string; payload: Record<string, unknown> }[] = []
  let answer = 200

  test.beforeAll(async () => {
    tool = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        received.push({ path: req.url ?? '', payload: decodeCouplingToken(body) })
        res.writeHead(answer, { 'content-type': 'application/json' }).end(answer === 200 ? '{"ok":true}' : '{"ok":false}')
      })
    })
    await new Promise<void>(resolve => tool.listen(Number(new URL(TEST_ABSTIMMUNGSTOOL_BASE_URL).port), '127.0.0.1', resolve))
  })
  test.afterAll(async () => { await new Promise(resolve => tool.close(resolve)) })

  test('speichern meldet die Verknüpfung, schon verknüpfte oder unbekannte Sitzungen und fremde Links werden abgelehnt', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const event = await createEvent(owner, { enableCheckin: true })
    await login(page, owner.email)
    await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=verknuepfungen`)
    const stored = async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).assemblyUrl
    const id = assemblyId()

    answer = 409
    await submitForm(page, await readForm(page, '#event-settings-form'), { assemblyUrl: assemblyUrl(id) })
    expect(await stored()).toBeNull()
    answer = 404
    await submitForm(page, await readForm(page, '#event-settings-form'), { assemblyUrl: assemblyUrl(id) })
    expect(await stored()).toBeNull()
    await submitForm(page, await readForm(page, '#event-settings-form'), { assemblyUrl: `http://127.0.0.1:3199/sitzung/${id}` })
    expect(await stored()).toBeNull()

    answer = 200
    received.length = 0
    await submitForm(page, await readForm(page, '#event-settings-form'), { assemblyUrl: `${assemblyUrl(id)}/` })
    expect(await stored()).toBe(assemblyUrl(id))
    expect(received).toHaveLength(1)
    expect(received[0].path).toBe('/api/rsvp-assembly')
    expect(received[0].payload).toMatchObject({ typ: 'assembly-link', assemblyId: id, eventId: event.id, eventTitle: event.title })
    // Unverändert gespeichert: keine neue Meldung; leer entfernt die Sitzung
    await submitForm(page, await readForm(page, '#event-settings-form'))
    expect(received).toHaveLength(1)
    await submitForm(page, await readForm(page, '#event-settings-form'), { assemblyUrl: '' })
    expect(await stored()).toBeNull()
  })
})

test('Zur Sitzung: nur mit Zusage, die zählt - Nachweis mit Pseudonym und Name, ohne E-Mail', async ({ page, request }) => {
  const owner = await createAccount('CREATOR')
  const id = assemblyId()
  const event = await createEvent(owner, { enableCheckin: true, assemblyUrl: assemblyUrl(id) })
  const { participant, rsvp } = await createRsvp(event, { name: 'Anna Abgeordnete' })
  await prisma.participant.update({ where: { id: participant.id }, data: { email: 'anna@example.test' } })

  // Gästeseite: Knopf mit eigenem Link
  await page.goto(`/${event.slug}?token=${participant.editToken}`)
  await expect(page.getByRole('link', { name: /Zur Sitzung/ })).toHaveAttribute('href', `/api/assembly-link/${event.id}?token=${participant.editToken}`)

  const response = await request.get(`/api/assembly-link/${event.id}?token=${participant.editToken}`, { maxRedirects: 0 })
  expect(response.status()).toBe(303)
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  const target = locationOf(response)!
  expect(`${target.origin}${target.pathname}`).toBe(`${TEST_ABSTIMMUNGSTOOL_BASE_URL}/sitzung/${id}/beitreten`)
  const payload = verified(target.searchParams.get('verify')!)
  expect(payload).toMatchObject({ typ: 'assembly-access', assemblyId: id, eventId: event.id, sub: sub(id, rsvp.id), name: 'Anna Abgeordnete' })
  expect(Number(payload.exp) - Date.now() / 1000).toBeLessThanOrEqual(15 * 60)
  expect(JSON.stringify(payload)).not.toContain('anna@example.test')
  expect(JSON.stringify(payload)).not.toContain(rsvp.id)

  // Absage, Warteliste, fremder Token, Termin ohne Sitzung: nie zur Sitzung
  const { participant: declined } = await createRsvp(event, { isAttending: false })
  const { participant: waiting } = await createRsvp(event, { isOnWaitlist: true })
  for (const token of [declined.editToken, waiting.editToken, 'kein-token']) {
    const back = locationOf(await request.get(`/api/assembly-link/${event.id}?token=${token}`, { maxRedirects: 0 }))!
    expect(back.origin).not.toBe(TEST_ABSTIMMUNGSTOOL_BASE_URL)
  }
  await page.goto(`/${event.slug}?token=${declined.editToken}`)
  await expect(page.getByRole('link', { name: /Zur Sitzung/ })).toHaveCount(0)
  const plain = await createEvent(owner)
  expect(locationOf(await request.get(`/api/assembly-link/${plain.id}?token=${participant.editToken}`, { maxRedirects: 0 }))!.pathname).toBe('/')
})

test('Anwesenheit fürs Abstimmungstool: nur Eingecheckte, die nicht gegangen sind - signiert, nur für die verlinkte Sitzung', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const id = assemblyId()
  const event = await createEvent(owner, { enableCheckin: true, trackPresence: true, assemblyUrl: assemblyUrl(id) })
  const { rsvp: here } = await createRsvp(event)
  const { rsvp: left } = await createRsvp(event)
  const { rsvp: away } = await createRsvp(event)
  await createRsvp(event, { isAttending: false })
  await createRsvp(event, { isOnWaitlist: true })
  await prisma.rsvp.update({ where: { id: here.id }, data: { hasAttended: true, checkedInAt: new Date() } })
  await prisma.rsvp.update({ where: { id: left.id }, data: { hasAttended: true, checkedInAt: new Date(), leftAt: new Date() } })
  const ask = (payload: object, secret?: string) => request.post('/api/assembly/roster', { data: signCouplingToken(payload, secret), headers: { 'content-type': 'text/plain' } })

  const response = await ask({ typ: 'assembly-roster', assemblyId: id, eventId: event.id, exp: exp() })
  expect(response.status()).toBe(200)
  const payload = verified(await response.text())
  expect(payload).toMatchObject({ typ: 'assembly-roster-result', assemblyId: id, eventId: event.id, checkin: true, members: 3, present: [sub(id, here.id)] })
  expect(JSON.stringify(payload)).not.toContain(away.id)

  // Falsches Secret, ohne typ, abgelaufen, fremde Sitzung: keine Antwort
  expect((await ask({ typ: 'assembly-roster', assemblyId: id, eventId: event.id, exp: exp() }, 'falsch')).status()).toBe(401)
  expect((await ask({ assemblyId: id, eventId: event.id, exp: exp() })).status()).toBe(401)
  expect((await ask({ typ: 'assembly-roster', assemblyId: id, eventId: event.id, exp: Math.floor(Date.now() / 1000) - 10 })).status()).toBe(401)
  expect((await ask({ typ: 'assembly-roster', assemblyId: assemblyId(), eventId: event.id, exp: exp() })).status()).toBe(404)

  // Ohne QR-Einlass ist niemand anwesend
  await prisma.event.update({ where: { id: event.id }, data: { enableCheckin: false } })
  expect(verified(await (await ask({ typ: 'assembly-roster', assemblyId: id, eventId: event.id, exp: exp() })).text())).toMatchObject({ checkin: false, present: [] })
})
