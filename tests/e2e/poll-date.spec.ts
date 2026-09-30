import { expect, test, type APIRequestContext } from '@playwright/test'
import { TEST_ABSTIMMUNGSTOOL_BASE_URL, TEST_CRON_SECRET } from '../../playwright.config'
import { createAccount, createEvent, createRsvp, FOREIGN_TOOL_BASE_URL, login, prisma, readForm, signCouplingToken, submitForm, unique } from './helpers'

// Terminabstimmung mit dem Abstimmungstool (app/lib/poll-date.ts, POST /api/poll-date):
// Das Abstimmungstool meldet den festgelegten Termin; verknüpfte Events mit "Datum noch offen"
// übernehmen ihn, oder es entsteht ein neues Event für den über den Verbund verknüpften Owner.

const nowSeconds = () => Math.floor(Date.now() / 1000)
const pollUrl = (pollId: string, origin = TEST_ABSTIMMUNGSTOOL_BASE_URL) => `${origin}/${pollId}`
const newPollId = () => `poll${unique()}`

function status(pollId: string, owner = { toolUserId: 'tool-user', rsvpUserId: null as string | null }, overrides: Record<string, unknown> = {}) {
  return signCouplingToken({ typ: 'poll-date-status', pollId, owner, exp: nowSeconds() + 300, ...overrides })
}

function setDate(pollId: string, overrides: Record<string, unknown> = {}) {
  return signCouplingToken({
    typ: 'poll-date-set', pollId, pollTitle: 'Sommerfest', startsAt: '2026-11-07T17:00:00.000Z',
    owner: { toolUserId: 'tool-user', rsvpUserId: null }, create: false, skipEmailHashes: [], exp: nowSeconds() + 300, ...overrides
  })
}

async function send(request: APIRequestContext, body: string) {
  return request.post('/api/poll-date', { data: body, headers: { 'content-type': 'text/plain' } })
}

test('fremd signierte, abgelaufene und andere Nachrichtenarten werden abgelehnt', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const pollId = newPollId()
  const event = await createEvent(owner, { pollUrl: pollUrl(pollId), datePending: true })

  const attacks: Record<string, string> = {
    'falsches Geheimnis': signCouplingToken({ typ: 'poll-date-set', pollId, pollTitle: 'x', startsAt: '2026-11-07T17:00:00.000Z', owner: { toolUserId: 'u', rsvpUserId: null }, create: false, skipEmailHashes: [], exp: nowSeconds() + 300 }, 'anderes-geheimnis'),
    'abgelaufen': setDate(pollId, { exp: nowSeconds() - 5 }),
    'Ergebnis-Meldung (kein typ)': signCouplingToken({ eventId: event.id, pollId, pollTitle: 'x', winners: [], closedAt: new Date().toISOString(), exp: nowSeconds() + 300 }),
    'Klick-Token (kein typ)': signCouplingToken({ email: 'a@example.test', pollId, attending: true, exp: nowSeconds() + 300 }),
    'leer': ''
  }
  for (const [name, body] of Object.entries(attacks)) {
    expect((await send(request, body)).status(), name).toBe(401)
  }
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ datePending: true })

  // Positivkontrolle: dieselbe Meldung richtig signiert
  expect((await send(request, setDate(pollId))).status()).toBe(200)
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ datePending: false })
})

test('Termin setzen: nur verknüpfte Events mit offenem Datum, einmalig', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const pollId = newPollId()
  const pending = await createEvent(owner, { pollUrl: pollUrl(pollId), datePending: true })
  const fixed = await createEvent(owner, { pollUrl: pollUrl(pollId), datePending: false })
  // Gleiche Poll-ID, aber fremder Origin - gehört nicht zum eingerichteten Abstimmungstool.
  const foreign = await createEvent(owner, { pollUrl: pollUrl(pollId, FOREIGN_TOOL_BASE_URL), datePending: true })
  const otherPoll = await createEvent(owner, { pollUrl: pollUrl(newPollId()), datePending: true })
  await createRsvp(pending)

  const statusResponse = await send(request, status(pollId))
  expect(await statusResponse.json()).toMatchObject({
    ok: true, canCreate: false,
    events: expect.arrayContaining([{ id: pending.id, title: pending.title, datePending: true }, { id: fixed.id, title: fixed.title, datePending: false }])
  })
  expect((await (await send(request, status(pollId))).json()).events).toHaveLength(2)

  const first = await (await send(request, setDate(pollId))).json()
  expect(first.updated.map((e: { id: string }) => e.id)).toEqual([pending.id])
  expect(first.unchanged.map((e: { id: string }) => e.id)).toEqual([fixed.id])
  expect(first.created).toBeNull()

  const after = await prisma.event.findUniqueOrThrow({ where: { id: pending.id } })
  expect(after).toMatchObject({ datePending: false, icsSequence: pending.icsSequence + 1 })
  expect(after.date.toISOString()).toBe('2026-11-07T17:00:00.000Z')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: fixed.id } })).date.toISOString()).toBe(fixed.date.toISOString())
  for (const untouched of [foreign, otherPoll]) {
    expect(await prisma.event.findUniqueOrThrow({ where: { id: untouched.id } })).toMatchObject({ datePending: true })
  }

  // Wiederholte Meldung: nichts mehr offen, nichts geändert
  const again = await (await send(request, setDate(pollId, { startsAt: '2026-12-24T17:00:00.000Z' }))).json()
  expect(again.updated).toEqual([])
  expect((await prisma.event.findUniqueOrThrow({ where: { id: pending.id } })).date.toISOString()).toBe('2026-11-07T17:00:00.000Z')
})

test('neues Event nur für einen über den Verbund verknüpften Owner mit eigener Event-Berechtigung', async ({ request }) => {
  const creator = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const toolCreator = `tool-${unique()}`
  const toolModerator = `tool-${unique()}`
  await prisma.externalIdentity.create({ data: { issuer: TEST_ABSTIMMUNGSTOOL_BASE_URL, subject: toolCreator, userId: creator.id } })
  await prisma.externalIdentity.create({ data: { issuer: TEST_ABSTIMMUNGSTOOL_BASE_URL, subject: toolModerator, userId: moderator.id } })
  // Verknüpfung mit einem ANDEREN Anbieter zählt nicht.
  const toolElsewhere = `tool-${unique()}`
  await prisma.externalIdentity.create({ data: { issuer: FOREIGN_TOOL_BASE_URL, subject: toolElsewhere, userId: creator.id } })

  const canCreate = async (owner: { toolUserId: string; rsvpUserId: string | null }) =>
    (await (await send(request, status(newPollId(), owner))).json()).canCreate
  expect(await canCreate({ toolUserId: toolCreator, rsvpUserId: null })).toBe(true)
  expect(await canCreate({ toolUserId: toolModerator, rsvpUserId: null })).toBe(false)
  expect(await canCreate({ toolUserId: toolElsewhere, rsvpUserId: null })).toBe(false)
  expect(await canCreate({ toolUserId: `tool-${unique()}`, rsvpUserId: null })).toBe(false)
  // Verknüpfung dort angelegt: Das Abstimmungstool nennt unsere Konto-ID
  expect(await canCreate({ toolUserId: `tool-${unique()}`, rsvpUserId: creator.id })).toBe(true)
  expect(await canCreate({ toolUserId: `tool-${unique()}`, rsvpUserId: moderator.id })).toBe(false)

  // Ohne Wunsch (create: false) kein Event
  const pollId = newPollId()
  const owner = { toolUserId: toolCreator, rsvpUserId: null }
  expect((await (await send(request, setDate(pollId, { owner }))).json()).created).toBeNull()
  // Moderator: kein Event
  expect((await (await send(request, setDate(pollId, { owner: { toolUserId: toolModerator, rsvpUserId: null }, create: true }))).json()).created).toBeNull()
  expect(await prisma.event.count({ where: { pollUrl: pollUrl(pollId) } })).toBe(0)

  // Positivkontrolle: angelegt für den Creator, mit Verweis auf die Abstimmung
  const response = await (await send(request, setDate(pollId, { owner, create: true, pollTitle: 'Grillabend Süd' }))).json()
  expect(response.created).toMatchObject({ title: 'Grillabend Süd' })
  const created = await prisma.event.findUniqueOrThrow({ where: { id: response.created.id } })
  expect(created).toMatchObject({ ownerId: creator.id, pollUrl: pollUrl(pollId), datePending: false })
  expect(created.slug).toMatch(/^grillabend-sud-[0-9a-f]{6}$/)
  expect(response.created.url).toContain(`/${created.slug}`)

  // Wiederholung legt kein zweites an
  expect((await (await send(request, setDate(pollId, { owner, create: true }))).json()).created).toBeNull()
  expect(await prisma.event.count({ where: { pollUrl: pollUrl(pollId) } })).toBe(1)
})

test('Datum noch offen: Formular nur mit Abstimmungslink, Hinweis für Gäste, kein Kalender, keine Erinnerung', async ({ page, request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { autoReminder: true, reminderDays: 60 })
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = await readForm(page, 'form:has(input[name="datePending"])')

  // Ohne Abstimmungslink wirkt der Haken nicht
  await submitForm(page, form, { datePending: 'on', pollUrl: '' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).datePending).toBe(false)
  // Positivkontrolle: mit Link
  await submitForm(page, form, { datePending: 'on', pollUrl: pollUrl(newPollId()) })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).datePending).toBe(true)

  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Datum wird noch abgestimmt - sobald es feststeht')).toBeVisible()
  expect((await request.get(`/api/ical/${event.id}`)).status()).toBe(404)

  await createRsvp(event)
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).reminderSent).toBe(false)
  // Positivkontrolle: mit festem Datum geht die Erinnerung raus
  await prisma.event.update({ where: { id: event.id }, data: { datePending: false } })
  expect((await request.get(`/api/ical/${event.id}`)).status()).toBe(200)
  await request.get(`/api/cron/reminders?secret=${TEST_CRON_SECRET}`)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).reminderSent).toBe(true)
})
