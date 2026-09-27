import { expect, test, type Browser } from '@playwright/test'
import type { Participant, User } from '@prisma/client'
import {
  createAccount, createEvent, createGuestUser, createRsvp, createSeries, createTermin, login, prisma, readForm,
  submitForm, unique
} from './helpers'

// Verwaiste Participants (keine Rsvp mehr) werden beim Löschen eines Termins, einer Antwort oder eines
// Kontos sofort mitgelöscht (deleteOrphanedParticipants, app/lib/participants.ts) - nicht erst beim
// nächsten Cron-Lauf. Wer noch eine andere Antwort hat, bleibt. Gelöscht wird über die echten
// Admin-Formulare (readForm/submitForm), mit dem jeweils zu löschenden Datensatz eingesetzt.

async function withPush(participant: Participant) {
  await prisma.participantPushSubscription.create({
    data: { endpoint: `https://push.example.test/${unique()}`, p256dh: 'p256dh', auth: 'auth', participantId: participant.id }
  })
  return participant
}

const exists = async (participant: Participant) => !!(await prisma.participant.findUnique({ where: { id: participant.id } }))
const pushCount = (participant: Participant) => prisma.participantPushSubscription.count({ where: { participantId: participant.id } })

/** Dashboard eines Kontos mit den beiden Lösch-Formularen (Termin, Antwort) zum Nachspielen. */
async function dashboardForms(browser: Browser, owner: User) {
  const page = await browser.newPage()
  await login(page, owner.email)
  await page.goto('/admin')
  const deleteEvent = await readForm(page, 'form:has(input[name="eventId"]):has(button:has-text("Löschen"))')
  const deleteRsvp = await readForm(page, 'form:has(input[name="rsvpId"]):has(button[title="Antwort löschen"])')
  return {
    deleteEvent: (eventId: string) => submitForm(page, deleteEvent, { eventId }),
    deleteRsvp: (rsvpId: string) => submitForm(page, deleteRsvp, { rsvpId })
  }
}

test('Termin löschen: Gäste ohne weitere Antwort sofort weg, alle anderen bleiben', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const doomed = await createEvent(owner)
  const other = await createEvent(owner)
  const onlyHere = await withPush((await createRsvp(doomed)).participant)
  const alsoElsewhere = await withPush((await createRsvp(doomed)).participant)
  await createRsvp(other, { participantId: alsoElsewhere.id })
  const unrelated = (await createRsvp(other)).participant

  const forms = await dashboardForms(browser, owner)
  await forms.deleteEvent(doomed.id)
  expect(await prisma.event.findUnique({ where: { id: doomed.id } })).toBeNull()

  expect(await exists(onlyHere)).toBe(false)
  expect(await pushCount(onlyHere)).toBe(0)
  // Positivkontrollen: noch eine Antwort zu einem anderen Termin -> Profil und Push-Abo bleiben
  expect(await exists(alsoElsewhere)).toBe(true)
  expect(await pushCount(alsoElsewhere)).toBe(1)
  expect(await prisma.rsvp.count({ where: { participantId: alsoElsewhere.id } })).toBe(1)
  expect(await exists(unrelated)).toBe(true)
})

test('Reihen-Termin löschen: Konto-Gast mit weiterem Termin bleibt, nach dem letzten Termin nur das Profil weg', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  await createEvent(owner) // damit das Dashboard ein Lösch-Formular für Termine enthält
  const series = await createSeries(owner)
  const first = await createTermin(series)
  const second = await createTermin(series)
  const guest = await createGuestUser()
  await prisma.guestUserSeries.create({ data: { guestUserId: guest.id, seriesId: series.id } })
  const shared = await withPush((await createRsvp(first, { guestUserId: guest.id })).participant)
  await createRsvp(second, { participantId: shared.id })

  const forms = await dashboardForms(browser, owner)
  await forms.deleteEvent(first.id)
  expect(await prisma.event.findUnique({ where: { id: first.id } })).toBeNull()
  expect(await exists(shared)).toBe(true)
  expect(await pushCount(shared)).toBe(1)

  await forms.deleteEvent(second.id)
  expect(await exists(shared)).toBe(false)
  expect(await pushCount(shared)).toBe(0)
  // Nutzer-Konto und Reihen-Mitgliedschaft bleiben - die nächste Antwort legt den Participant neu an
  expect(await prisma.guestUser.findUnique({ where: { id: guest.id } })).not.toBeNull()
  expect(await prisma.guestUserSeries.count({ where: { guestUserId: guest.id, seriesId: series.id } })).toBe(1)
})

test('Einzelne Antwort löschen: Participant weg, außer er hat noch eine andere Antwort', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const other = await createEvent(owner)
  const single = await createRsvp(event)
  await withPush(single.participant)
  const multi = await createRsvp(event)
  await createRsvp(other, { participantId: multi.participant.id })

  const forms = await dashboardForms(browser, owner)
  await forms.deleteRsvp(single.rsvp.id)
  expect(await prisma.rsvp.findUnique({ where: { id: single.rsvp.id } })).toBeNull()
  expect(await exists(single.participant)).toBe(false)
  expect(await pushCount(single.participant)).toBe(0)

  // Positivkontrolle: dieselbe Aktion bei einem Participant mit weiterer Antwort
  await forms.deleteRsvp(multi.rsvp.id)
  expect(await prisma.rsvp.findUnique({ where: { id: multi.rsvp.id } })).toBeNull()
  expect(await exists(multi.participant)).toBe(true)
})

test('Konto löschen (Admin): Gäste seiner Einzel-Events und Reihen weg, fremde bleiben', async ({ browser }) => {
  const admin = await createAccount('ADMIN')
  const target = await createAccount('CREATOR')
  const bystander = await createAccount('CREATOR')
  const standaloneGuest = await withPush((await createRsvp(await createEvent(target))).participant)
  const seriesGuest = (await createRsvp(await createTermin(await createSeries(target)))).participant
  const foreignGuest = (await createRsvp(await createEvent(bystander))).participant

  const page = await browser.newPage()
  await login(page, admin.email)
  await page.goto('/admin/users')
  const deleteUser = await readForm(page, 'form:has(input[name="userId"]):has(button:has-text("Löschen"))')
  await submitForm(page, deleteUser, { userId: target.id })
  expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull()

  expect(await exists(standaloneGuest)).toBe(false)
  expect(await pushCount(standaloneGuest)).toBe(0)
  expect(await exists(seriesGuest)).toBe(false)
  expect(await exists(foreignGuest)).toBe(true)
})

test('Reihe löschen: unverändert alle Gäste der Reihe weg, die anderer Reihen bleiben', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const first = await createTermin(series)
  const second = await createTermin(series)
  const both = (await createRsvp(first)).participant
  await createRsvp(second, { participantId: both.id })
  const onlySecond = (await createRsvp(second)).participant
  const otherSeriesGuest = (await createRsvp(await createTermin(await createSeries(owner)))).participant

  const page = await browser.newPage()
  await login(page, owner.email)
  await page.goto(`/admin/series/${series.id}`)
  const deleteSeries = await readForm(page, 'form:has(input[name="seriesId"]):has(button:has-text("Reihe löschen"))')
  await submitForm(page, deleteSeries)
  expect(await prisma.eventSeries.findUnique({ where: { id: series.id } })).toBeNull()

  expect(await exists(both)).toBe(false)
  expect(await exists(onlySecond)).toBe(false)
  expect(await exists(otherSeriesGuest)).toBe(true)
})
