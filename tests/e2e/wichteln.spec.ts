import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { signLinkMessage } from 'suite-kit'
import { TEST_SEATING_SECRET, TEST_WICHTELN_BASE_URL, TEST_WICHTELN_SECRET, WICHTELN_PORT } from '../../playwright.config'
import { BASE_URL, createAccount, createEvent, createRsvp, decodeCouplingToken, linkTool, prisma } from './helpers'

// Anbindung an Wichteln (app/lib/wichteln.ts, Gegenstück dort app/lib/rsvp/token.ts): Gästeliste nur für genau so
// verknüpfte Termine und nur gültige Zusagen mit E-Mail; Anstoß rsvp-change bei jeder Änderung - ohne Namen.

type Received = { path: string; body: string }
const toWichteln: Received[] = []
let server: Server

test.beforeAll(async () => {
  server = await new Promise<Server>(resolve => {
    const s = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        toWichteln.push({ path: req.url ?? '', body })
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    s.listen(WICHTELN_PORT, '127.0.0.1', () => resolve(s))
  })
})

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

const OWN = new URL(BASE_URL).origin
const wichtelnId = () => 'cmwichtel' + randomBytes(10).toString('hex')

async function linkedEvent() {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const remote = wichtelnId()
  await linkTool(event, 'wichteln', `${TEST_WICHTELN_BASE_URL}/rsvp/${remote}`)
  return { event, remote }
}

function request(wichtelnEventId: string, rsvpEventId: string, options: { secret?: string; aud?: string; typ?: string } = {}) {
  return signLinkMessage(options.typ ?? 'wichtel-guests-request', options.aud ?? OWN, { wichtelnEventId, rsvpEventId }, options.secret ?? TEST_WICHTELN_SECRET)
}

test('Gästeliste: nur Zusagen mit E-Mail, nur für genau so verknüpfte Termine, signiert an Wichteln', async ({ request: http }) => {
  const { event, remote } = await linkedEvent()
  const anna = await createRsvp(event, { name: 'Anna' })
  await prisma.participant.update({ where: { id: anna.participant.id }, data: { email: 'Anna@Example.test' } })
  const waiting = await createRsvp(event, { isOnWaitlist: true })
  const declined = await createRsvp(event, { isAttending: false })
  await prisma.participant.updateMany({ where: { id: { in: [waiting.participant.id, declined.participant.id] } }, data: { email: 'andere@example.test' } })
  await createRsvp(event, { name: 'Ohne Adresse' })
  const post = (body: string) => http.post('/api/wichteln/guests', { data: body, headers: { 'content-type': 'text/plain' } })

  // Ungültig: falsches Secret (z.B. das von Seating), falscher Empfänger, andere Art, fremdes Wichteln, zu groß
  expect((await post(request(remote, event.id, { secret: TEST_SEATING_SECRET }))).status()).toBe(401)
  expect((await post(request(remote, event.id, { aud: TEST_WICHTELN_BASE_URL }))).status()).toBe(401)
  expect((await post(request(remote, event.id, { typ: 'rsvp-change' }))).status()).toBe(401)
  expect((await post(request(wichtelnId(), event.id))).status()).toBe(404)
  expect((await post('x'.repeat(6000))).status()).toBe(413)

  // Positivkontrolle
  const response = await post(request(remote, event.id))
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  const token = await response.text()
  const [payload, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_WICHTELN_SECRET).update(payload).digest('base64url'))
  expect(decodeCouplingToken(token)).toEqual({
    typ: 'wichtel-guests', aud: TEST_WICHTELN_BASE_URL, wichtelnEventId: remote, rsvpEventId: event.id,
    guests: [{ rsvpId: anna.rsvp.id, name: 'Anna', email: 'anna@example.test' }],
    iat: expect.any(Number), exp: expect.any(Number)
  })
})

test('Anstoß rsvp-change bei einer Zusage - nur Kennungen, an Wichteln mit eigenem Secret', async ({ page }) => {
  const { event, remote } = await linkedEvent()
  const before = toWichteln.length
  await page.goto(`/${event.slug}`)
  await page.getByLabel('Dein Name').fill('Wichtel-Gast')
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Deine Rückmeldung wurde erfolgreich gespeichert.')).toBeVisible()

  const mine = () => toWichteln.slice(before).filter(r => r.path === '/api/rsvp-webhook').map(r => r.body).filter(b => decodeCouplingToken(b).wichtelnEventId === remote)
  await expect.poll(() => mine().length).toBe(1)
  const [body] = mine()
  const [payload, signature] = body.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_WICHTELN_SECRET).update(payload).digest('base64url'))
  expect(decodeCouplingToken(body)).toEqual({ typ: 'rsvp-change', aud: TEST_WICHTELN_BASE_URL, wichtelnEventId: remote, rsvpEventId: event.id, iat: expect.any(Number), exp: expect.any(Number) })
  expect(body).not.toContain(Buffer.from('Wichtel-Gast').toString('base64url'))

  // Ein nicht verknüpfter Termin stößt nichts an
  const owner = await createAccount('CREATOR')
  const unlinked = await createEvent(owner)
  const count = toWichteln.length
  await page.goto(`/${unlinked.slug}`)
  await page.getByLabel('Dein Name').fill('Ohne Wichteln')
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Deine Rückmeldung wurde erfolgreich gespeichert.')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(toWichteln.length).toBe(count)
})
