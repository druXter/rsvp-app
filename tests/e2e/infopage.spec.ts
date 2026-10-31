import { expect, test } from '@playwright/test'
import { TEST_STARTSEITE_BASE_URL, TEST_STARTSEITE_SECRET } from '../../playwright.config'
import { BASE_URL, createAccount, createEvent, createRsvp, linkTool, locationOf, login, prisma, readForm, submitForm } from './helpers'
import { openMessage } from '../../app/lib/linked-tools'

// Infoseite in der Startseite (Idee L38, app/lib/infopage.ts): „Infos für Gäste“ nur für Zusagen, die zählen - mit
// einem frischen, signierten Link, der nur Kennungen enthält. Alles andere landet wieder auf der Event-Seite.

test('nur eine zählende Zusage kommt mit signiertem Link zur Infoseite, sonst zurück zur Event-Seite', async ({ page, request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await linkTool(event, 'infopage', `${TEST_STARTSEITE_BASE_URL}/rsvp/cmpageinfoe2e0001`)
  const yes = await createRsvp(event, { name: 'Anna Zusage' })
  const no = await createRsvp(event, { name: 'Ben Absage', isAttending: false })
  const waiting = await createRsvp(event, { name: 'Cleo Warteliste', isOnWaitlist: true })
  const other = await createEvent(owner)
  const foreign = await createRsvp(other)

  const go = (token: string) => request.get(`/api/info-link/${event.id}?token=${encodeURIComponent(token)}`, { maxRedirects: 0 })

  // Positivkontrolle: Zusage -> Startseite mit signiertem Link, nur Kennungen
  const ok = await go(yes.participant.editToken)
  expect(ok.status()).toBe(303)
  const target = locationOf(ok)!
  expect(target.origin).toBe(TEST_STARTSEITE_BASE_URL)
  expect(target.pathname).toBe('/rsvp/cmpageinfoe2e0001')
  const message = openMessage(target.searchParams.get('t')!, TEST_STARTSEITE_SECRET) as Record<string, unknown>
  expect(message).toMatchObject({ typ: 'info-page-link', aud: TEST_STARTSEITE_BASE_URL, pageId: 'cmpageinfoe2e0001', rsvpEventId: event.id, rsvpId: yes.rsvp.id })
  expect(JSON.stringify(message)).not.toContain('Anna')
  expect(ok.headers()['referrer-policy']).toBe('no-referrer')

  // Absage, Warteliste, Link eines anderen Termins: zurück zur Event-Seite, nie zur Startseite
  for (const token of [no.participant.editToken, waiting.participant.editToken, foreign.participant.editToken, 'erfunden']) {
    const response = await go(token)
    expect(locationOf(response)!.origin, token).toBe(BASE_URL)
  }

  // Gästeseite: Knopf nur für die Zusage
  await page.goto(`/${event.slug}?token=${yes.participant.editToken}`)
  await expect(page.getByTestId('info-page-box')).toBeVisible()
  await page.goto(`/${event.slug}?token=${no.participant.editToken}`)
  await expect(page.getByTestId('info-page-box')).toHaveCount(0)

  // Ohne Verknüpfung kein Knopf und keine Weiterleitung
  await prisma.eventToolLink.deleteMany({ where: { eventId: event.id } })
  expect(locationOf(await go(yes.participant.editToken))!.origin).toBe(BASE_URL)
})

test('Termin-Formular: Infoseite-Link nur mit dem Origin der Startseite', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=verknuepfungen`)
  const form = await readForm(page, 'form:has(input[name="infoPageUrl"])')
  // Angriff: fremder Origin wird abgelehnt (SSRF-Schutz), nichts gespeichert
  await submitForm(page, form, { infoPageUrl: 'http://127.0.0.1:3199/rsvp/cmpageinfoe2e0002' })
  expect(await prisma.eventToolLink.count({ where: { eventId: event.id, type: 'infopage' } })).toBe(0)
  // Positivkontrolle
  await submitForm(page, form, { infoPageUrl: `${TEST_STARTSEITE_BASE_URL}/rsvp/cmpageinfoe2e0002` })
  expect(await prisma.eventToolLink.findFirst({ where: { eventId: event.id, type: 'infopage' } })).toMatchObject({ remoteEventId: 'cmpageinfoe2e0002' })
})
