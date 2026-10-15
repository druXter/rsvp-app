import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { TEST_ABSTIMMUNGSTOOL_BASE_URL, TEST_POLL_SECRET } from '../../playwright.config'
import {
  BASE_URL, TEST_TIMELINE_BASE_URL, TEST_TIMELINE_SECRET, createAccount, createEvent, createRsvp, decodeCouplingToken, linkTool, login,
  prisma, readForm, signCouplingToken, submitForm
} from './helpers'

// Protokoll für den Zeitplan-Rückblick (Idee L7, app/lib/timeline-protocol.ts): Der Zeitplan fragt signiert an
// (TIMELINE_SECRET) und bekommt nur, was der Termin einzeln freigibt - Kommen und Gehen mit Namen und die Beschlüsse,
// die rsvp-app beim Abstimmungstool abruft. Das Abstimmungstool spielt hier ein Schein-Server, der jede Anfrage
// mitschreibt; seine Antwort legt jeder Test fest.

const remoteId = (prefix: string) => prefix + randomBytes(10).toString('hex')
const now = () => Math.floor(Date.now() / 1000)

let tool: Server
const asked: Record<string, unknown>[] = []
let answer: (request: Record<string, unknown>) => { status: number; body: string } = () => ({ status: 404, body: '' })

test.beforeAll(async () => {
  tool = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const request = decodeCouplingToken(body)
      asked.push({ path: req.url, ...request })
      const reply = answer(request)
      res.writeHead(reply.status, { 'content-type': 'text/plain' }).end(reply.body)
    })
  })
  await new Promise<void>(resolve => tool.listen(Number(new URL(TEST_ABSTIMMUNGSTOOL_BASE_URL).port), '127.0.0.1', resolve))
})
test.afterAll(async () => { await new Promise(resolve => tool.close(resolve)) })

async function linkedEvent(data: Parameters<typeof createEvent>[1] = {}) {
  const owner = await createAccount('CREATOR')
  const timelineEventId = remoteId('cmzeit')
  const assemblyId = remoteId('cmsitz')
  const event = await createEvent(owner, { enableCheckin: true, trackPresence: true, assemblyUrl: `${TEST_ABSTIMMUNGSTOOL_BASE_URL}/sitzung/${assemblyId}`, ...data })
  await linkTool(event, 'timeline', `${TEST_TIMELINE_BASE_URL}/rsvp/${timelineEventId}`)
  return { owner, event, timelineEventId, assemblyId }
}

/** Anfrage wie vom Zeitplan (createSignedMessage dort: { typ, ...Felder, iat, exp }). */
function ask(request: APIRequestContext, fields: Record<string, unknown>, secret = TEST_TIMELINE_SECRET) {
  const iat = now()
  const payload = { typ: 'protocol-request', aud: new URL(BASE_URL).origin, ...fields, iat, exp: iat + 300 }
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return request.post('/api/timeline/protocol', { data: `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`, headers: { 'content-type': 'text/plain' } })
}

/** Prüft die Signatur mit dem Secret des Zeitplans und gibt die Nutzlast zurück. */
async function protocol(response: Awaited<ReturnType<typeof ask>>) {
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  const token = await response.text()
  const [part, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', TEST_TIMELINE_SECRET).update(part).digest('base64url'))
  return decodeCouplingToken(token)
}

const decision = {
  title: 'Antrag 1: Satzung', secret: false, openedAt: '2026-10-15T18:10:00.000Z', closedAt: '2026-10-15T18:14:00.000Z', voters: 3, present: 4, quorumMet: true,
  options: [{ label: 'Ja', votes: 2, names: ['Anna', 'Ben'] }, { label: 'Nein', votes: 1, names: ['Cem'] }, { label: 'Enthaltung', votes: 0, names: [] }]
}

test('Schalter im Termin-Formular: einzeln, jeder für sich', async ({ page }) => {
  const { owner, event } = await linkedEvent()
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=verknuepfungen`)
  await expect(page.getByLabel('Kommen und Gehen im Zeitplan-Rückblick zeigen')).not.toBeChecked()
  await submitForm(page, await readForm(page, '#event-settings-form'), { timelinePresence: 'on' })
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ timelinePresence: true, timelineDecisions: false })
  const form = await readForm(page, '#event-settings-form')
  form.fields = form.fields.filter(([name]) => name !== 'timelinePresence')
  await submitForm(page, form, { timelineDecisions: 'on' })
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ timelinePresence: false, timelineDecisions: true })
})

test('Anfrage des Zeitplans: nur signiert, nur für den verlinkten Termin, nur was freigegeben ist', async ({ request }) => {
  const { event, timelineEventId, assemblyId } = await linkedEvent()
  const { rsvp } = await createRsvp(event, { name: 'Anna Abgeordnete' })
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 18, minute))
  await prisma.presenceEntry.createMany({
    data: [
      { eventId: event.id, rsvpId: rsvp.id, name: 'Anna Abgeordnete', kind: 'OUT', at: at(20) },
      { eventId: event.id, rsvpId: rsvp.id, name: 'Anna Abgeordnete', kind: 'IN', at: at(0) },
      { eventId: event.id, rsvpId: rsvp.id, name: 'Anna Abgeordnete', kind: 'IN', at: at(40) }
    ]
  })
  const fields = { timelineEventId, rsvpEventId: event.id }

  // Falsches Secret (das der Abstimmungstool-Kopplung), fremder Empfänger, falsche Art: 401; anderes Zeitplan-Event: 404
  expect((await ask(request, fields, TEST_POLL_SECRET)).status()).toBe(401)
  expect((await ask(request, { ...fields, aud: TEST_TIMELINE_BASE_URL })).status()).toBe(401)
  expect((await ask(request, { ...fields, typ: 'timeline-link' })).status()).toBe(401)
  expect((await ask(request, { ...fields, timelineEventId: remoteId('cmzeit') })).status()).toBe(404)

  // Nichts freigegeben: keine Namen, keine Anfrage beim Abstimmungstool
  asked.length = 0
  const closed = await protocol(await ask(request, fields))
  expect(closed).toMatchObject({ typ: 'protocol', aud: TEST_TIMELINE_BASE_URL, timelineEventId, rsvpEventId: event.id, presence: null, decisions: null, decisionsState: 'off' })
  expect(JSON.stringify(closed)).not.toContain('Anna')
  expect(asked).toHaveLength(0)

  // Nur Kommen und Gehen: in zeitlicher Reihenfolge, das zweite Kommen ist "kommt wieder"
  await prisma.event.update({ where: { id: event.id }, data: { timelinePresence: true } })
  const presence = await protocol(await ask(request, fields))
  expect(presence.presence).toEqual([
    { at: at(0).toISOString(), name: 'Anna Abgeordnete', change: 'IN' },
    { at: at(20).toISOString(), name: 'Anna Abgeordnete', change: 'OUT' },
    { at: at(40).toISOString(), name: 'Anna Abgeordnete', change: 'BACK' }
  ])
  expect(presence).toMatchObject({ decisions: null, decisionsState: 'off' })
  expect(asked).toHaveLength(0)

  // Nur Beschlüsse: signierte Anfrage ans Abstimmungstool, Antwort feldweise geprüft weitergegeben
  await prisma.event.update({ where: { id: event.id }, data: { timelinePresence: false, timelineDecisions: true } })
  answer = req => ({ status: 200, body: signCouplingToken({ typ: 'assembly-decisions-result', assemblyId: req.assemblyId, eventId: req.eventId, decisions: [decision], exp: now() + 300 }) })
  const decisions = await protocol(await ask(request, fields))
  expect(asked).toEqual([expect.objectContaining({ path: '/api/assembly/decisions', typ: 'assembly-decisions', assemblyId, eventId: event.id })])
  expect(decisions).toMatchObject({ presence: null, decisionsState: 'ok', decisions: [decision] })

  // Abstimmungstool falsch signiert, für eine andere Sitzung oder mit kaputtem Inhalt: "nicht erreichbar", nichts weitergegeben
  for (const bad of [
    () => signCouplingToken({ typ: 'assembly-decisions-result', assemblyId, eventId: event.id, decisions: [decision], exp: now() + 300 }, 'falsch-falsch-falsch'),
    () => signCouplingToken({ typ: 'assembly-decisions-result', assemblyId: remoteId('cmsitz'), eventId: event.id, decisions: [decision], exp: now() + 300 }),
    () => signCouplingToken({ typ: 'assembly-decisions-result', assemblyId, eventId: event.id, decisions: [{ ...decision, voters: -1 }], exp: now() + 300 })
  ]) {
    answer = () => ({ status: 200, body: bad() })
    expect(await protocol(await ask(request, fields))).toMatchObject({ decisions: null, decisionsState: 'unreachable' })
  }
  answer = () => ({ status: 500, body: '' })
  expect(await protocol(await ask(request, fields))).toMatchObject({ decisions: null, decisionsState: 'unreachable' })

  // Geheime Abstimmung: Namen werden nie weitergegeben, auch wenn sie kämen
  answer = req => ({ status: 200, body: signCouplingToken({ typ: 'assembly-decisions-result', assemblyId: req.assemblyId, eventId: req.eventId, decisions: [{ ...decision, secret: true }], exp: now() + 300 }) })
  const secret = await protocol(await ask(request, fields))
  expect(JSON.stringify(secret.decisions)).not.toContain('Anna')
})
