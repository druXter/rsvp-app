import { expect, test } from '@playwright/test'
import { cookieHeader, createAccount, createEvent, createRsvp, login, prisma, readForm, submitForm } from './helpers'

// Kommen und Gehen (Idee L7, app/lib/checkin.ts, Event.trackPresence): Auschecken heißt "geht", Wiederkommen per
// Scan oder Klick, jeder Wechsel mit Uhrzeit im Protokoll (Reiter "Anwesenheit", CSV), Fehlscans lassen sich
// zurücknehmen. Ohne die Option bleibt Auschecken eine Korrektur ohne Protokoll.

const kinds = async (rsvpId: string) =>
  (await prisma.presenceEntry.findMany({ where: { rsvpId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })).map(e => `${e.name}:${e.kind}`)

test('Scannen: kommen, gehen, wiederkommen, Fehlscan zurücknehmen, Anwesenheit und CSV', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { enableCheckin: true, trackPresence: true })
  const { rsvp } = await createRsvp(event, { name: 'Anna Abgeordnete' })
  const state = () => prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id }, select: { hasAttended: true, checkedInAt: true, leftAt: true } })

  await login(page, owner.email)
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  const arrived = (await state()).checkedInAt

  // Geht: bleibt "da gewesen", aber mit Uhrzeit des Gehens - die Seite checkt danach nicht wieder ein
  await page.getByTestId('checkin-leave').click()
  await page.waitForURL(`**/admin/checkin/${rsvp.id}?ansicht=1`)
  await expect(page.getByRole('heading', { name: /Gegangen um \d\d:\d\d/ })).toBeVisible()
  expect(await state()).toMatchObject({ hasAttended: true, checkedInAt: arrived, leftAt: expect.any(Date) })

  // Erneut scannen: wieder da, der erste Einlass bleibt
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Wieder da!' })).toBeVisible()
  expect(await state()).toMatchObject({ hasAttended: true, checkedInAt: arrived, leftAt: null })
  expect(await kinds(rsvp.id)).toEqual(['Anna Abgeordnete:IN', 'Anna Abgeordnete:OUT', 'Anna Abgeordnete:IN'])

  // Versehentlich gescannt: letzte Änderung zurücknehmen - sie ist wieder gegangen
  await page.getByRole('button', { name: 'Letzte Änderung zurücknehmen' }).click()
  await page.waitForURL(`**/admin/checkin/${rsvp.id}?ansicht=1`)
  await expect(page.getByRole('heading', { name: /Gegangen um/ })).toBeVisible()
  expect(await kinds(rsvp.id)).toEqual(['Anna Abgeordnete:IN', 'Anna Abgeordnete:OUT'])
  expect((await state()).leftAt).not.toBeNull()

  // Übersicht, Gästeliste und Reiter "Anwesenheit"
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByTestId('stat-checkin')).toContainText('Jetzt da')
  await expect(page.getByTestId('stat-checkin')).toContainText('0/1')
  await page.goto(`/admin/events/${event.id}/gaeste`)
  await expect(page.getByTestId('guest-checkin')).toContainText(/🚪 Weg seit \d\d:\d\d/)
  await page.getByRole('link', { name: 'Anwesenheit' }).click()
  await expect(page.getByTestId('presence-now')).toContainText('0')
  await expect(page.getByTestId('presence-list')).toContainText('Anna Abgeordnete')
  await expect(page.getByTestId('presence-list')).toContainText('gegangen')
  await expect(page.getByTestId('presence-timeline')).toContainText('Anna Abgeordnete kommt')
  await expect(page.getByTestId('presence-timeline')).toContainText('Anna Abgeordnete geht')

  // In der Gästeliste wieder einchecken: "kommt wieder"
  await page.goto(`/admin/events/${event.id}/gaeste`)
  await page.getByTestId('guest-checkin').getByRole('button').click()
  await expect(page.getByTestId('guest-checkin')).toContainText('🎫 Da')
  await page.goto(`/admin/events/${event.id}/anwesenheit`)
  await expect(page.getByTestId('presence-timeline')).toContainText('Anna Abgeordnete kommt wieder')
  await expect(page.getByTestId('presence-now')).toContainText('1')

  const csv = await (await page.request.get(`/api/export/anwesenheit?eventId=${event.id}`, { headers: await cookieHeader(page.context()) })).text()
  const lines = csv.replace(/^\uFEFF/, '').split('\n')
  expect(lines[0]).toBe('"Datum";"Uhrzeit";"Name";"Wechsel"')
  expect(lines.slice(1).map(l => l.split(';').slice(2).join(';'))).toEqual([
    '"Anna Abgeordnete";"kommt"', '"Anna Abgeordnete";"geht"', '"Anna Abgeordnete";"kommt wieder"'
  ])
})

test('Personen einzeln: eine geht, die Antwort bleibt da, bis alle weg sind', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { enableCheckin: true, trackPresence: true, maxCompanions: 1 })
  const { rsvp } = await createRsvp(event, { name: 'Anna' })
  await prisma.rsvpPerson.createMany({ data: [
    { rsvpId: rsvp.id, position: 0, name: 'Anna', isAttending: true },
    { rsvpId: rsvp.id, position: 1, name: 'Ben', isAttending: true }
  ] })
  const state = () => prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id }, select: { hasAttended: true, leftAt: true } })

  await login(page, owner.email)
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  const list = page.getByTestId('checkin-persons')
  await list.getByRole('listitem').filter({ hasText: 'Ben' }).getByRole('button', { name: 'Geht' }).click()
  await page.waitForURL(`**/admin/checkin/${rsvp.id}?ansicht=1`)
  await expect(page.getByRole('heading', { name: '1 von 2 da' })).toBeVisible()
  expect(await state()).toEqual({ hasAttended: true, leftAt: null })

  // Ben kommt wieder, dann gehen beide
  await list.getByRole('listitem').filter({ hasText: 'Ben' }).getByRole('button', { name: 'Kommt wieder' }).click()
  await expect(page.getByRole('heading', { name: 'Bereits eingecheckt' })).toBeVisible()
  await page.getByTestId('checkin-leave').click()
  await expect(page.getByRole('heading', { name: /Gegangen um/ })).toBeVisible()
  expect(await state()).toMatchObject({ hasAttended: true, leftAt: expect.any(Date) })
  expect(await kinds(rsvp.id)).toEqual(['Anna:IN', 'Ben:IN', 'Ben:OUT', 'Ben:IN', 'Anna:OUT', 'Ben:OUT'])

  // "Alle gehen" ist eine Änderung: Zurücknehmen bringt beide zurück
  await page.getByRole('button', { name: 'Letzte Änderung zurücknehmen' }).click()
  await expect(page.getByRole('heading', { name: 'Bereits eingecheckt' })).toBeVisible()
  expect(await state()).toEqual({ hasAttended: true, leftAt: null })
  expect((await prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id } })).every(p => p.checkedInAt && !p.leftAt)).toBe(true)
})

test('Ohne Kommen und Gehen: Auschecken ist eine Korrektur, kein Protokoll, kein Reiter', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { enableCheckin: true })
  const { rsvp } = await createRsvp(event, { name: 'Clara' })

  await login(page, owner.email)
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  await expect(page.getByTestId('checkin-leave')).toHaveCount(0)
  await page.getByRole('button', { name: 'Rückgängig machen' }).click()
  await expect(page.getByRole('heading', { name: 'Nicht eingecheckt' })).toBeVisible()
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id }, select: { hasAttended: true, leftAt: true } })).toEqual({ hasAttended: false, leftAt: null })
  expect(await prisma.presenceEntry.count({ where: { eventId: event.id } })).toBe(0)
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByRole('link', { name: 'Anwesenheit' })).toHaveCount(0)
})

test('Einstellung: nur zusammen mit dem QR-Einlass; Zurücknehmen nur mit Rechten am Event', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { enableCheckin: true })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=ablauf`)
  const stored = () => prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { enableCheckin: true, trackPresence: true } })

  await expect(page.getByLabel('Kommen und Gehen protokollieren')).toBeEnabled()
  await submitForm(page, await readForm(page, '#event-settings-form'), { trackPresence: 'on' })
  expect(await stored()).toEqual({ enableCheckin: true, trackPresence: true })
  // Ohne Einlass kein Protokoll, auch wenn das Feld mitkommt
  await submitForm(page, await readForm(page, '#event-settings-form'), { enableCheckin: '', trackPresence: 'on' })
  expect(await stored()).toEqual({ enableCheckin: false, trackPresence: false })

  // Fremdes Konto kann nichts zurücknehmen (Positivkontrolle: das eigene Konto)
  await prisma.event.update({ where: { id: event.id }, data: { enableCheckin: true, trackPresence: true } })
  const { rsvp } = await createRsvp(event, { name: 'Dora' })
  await page.goto(`/admin/checkin/${rsvp.id}`)
  await expect(page.getByRole('heading', { name: 'Eingecheckt!' })).toBeVisible()
  const undo = await readForm(page, 'form:has(input[name="rsvpId"]):has(button:has-text("Letzte Änderung zurücknehmen"))')
  const stranger = await createAccount('CREATOR')
  const strangerPage = await (await browser.newContext()).newPage()
  await login(strangerPage, stranger.email)
  await submitForm(strangerPage, undo)
  expect(await kinds(rsvp.id)).toEqual(['Dora:IN'])
  await submitForm(page, undo)
  expect(await kinds(rsvp.id)).toEqual([])
  expect(await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id }, select: { hasAttended: true } })).toEqual({ hasAttended: false })
})
