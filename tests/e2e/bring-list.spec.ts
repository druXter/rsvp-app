import { expect, test, type Page } from '@playwright/test'
import { syncBringClaims } from '../../app/lib/bring-list'
import { cookieHeader, createAccount, createEvent, createRsvp, login, prisma, readForm, submitForm } from './helpers'

// Mitbringliste (BringSlot/BringClaim, app/lib/bring-list.ts, Idee L5 der Suite): Liste im Termin-Formular,
// Beanspruchen beim Zusagen, volle Einträge gesperrt (auch serverseitig und bei gleichzeitigen Zusagen),
// Absage und Warteliste geben frei, Anzeige in Gästeliste, Verwaltung und CSV.

async function answer(page: Page, slug: string, name: string, slots: string[], attending = true) {
  await page.goto(`/${slug}`)
  await page.getByLabel('Dein Name').fill(name)
  await page.locator(`input[name="isAttending"][value="${attending}"]`).check()
  for (const label of slots) await page.getByRole('checkbox', { name: new RegExp(`^${label}`) }).check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText(attending ? 'Deine Rückmeldung wurde erfolgreich gespeichert.' : 'Deine Absage wurde erfolgreich gespeichert.')).toBeVisible()
}

async function claimsOf(eventId: string) {
  const slots = await prisma.bringSlot.findMany({ where: { eventId }, orderBy: { position: 'asc' }, include: { claims: { include: { rsvp: { include: { participant: true } } } } } })
  return Object.fromEntries(slots.map(s => [s.label, s.claims.map(c => c.rsvp.participant.name).sort()]))
}

test('Liste im Termin-Formular speichern; Abgleich nach Bezeichnung behält Beanspruchungen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/edit/${event.id}`)
  const form = () => readForm(page, 'form:has(textarea[name="bringSlots"])')

  await submitForm(page, await form(), { bringSlots: '2x Salat\nGetränke' })
  const first = await prisma.bringSlot.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } })
  expect(first.map(s => [s.label, s.quantity])).toEqual([['Salat', 2], ['Getränke', 1]])
  const { rsvp } = await createRsvp(event, { isAttending: true, name: 'Bea' })
  await prisma.bringClaim.create({ data: { slotId: first[0].id, rsvpId: rsvp.id } })

  await page.reload()
  await expect(page.locator('textarea[name="bringSlots"]')).toHaveValue('2x Salat\nGetränke')
  await submitForm(page, await form(), { bringSlots: 'Nachtisch\n3x Salat' })
  const second = await prisma.bringSlot.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } })
  expect(second.map(s => [s.label, s.quantity])).toEqual([['Nachtisch', 1], ['Salat', 3]])
  expect(second[1].id).toBe(first[0].id)
  expect(await claimsOf(event.id)).toEqual({ Nachtisch: [], Salat: ['Bea'] })

  // Ungültige Liste: nichts ändert sich
  await submitForm(page, await form(), { bringSlots: '99x Salat' })
  expect((await prisma.bringSlot.findMany({ where: { eventId: event.id } })).length).toBe(2)
})

test('Gäste beanspruchen beim Zusagen; voll ist gesperrt, Absage gibt frei; Anzeige überall', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { isGuestListVisible: true })
  await prisma.bringSlot.createMany({ data: [{ eventId: event.id, label: 'Salat', quantity: 1, position: 0 }, { eventId: event.id, label: 'Getränke', quantity: 2, position: 1 }] })

  const anna = await browser.newPage()
  await answer(anna, event.slug, 'Anna', ['Salat', 'Getränke'])
  const ben = await browser.newPage()
  await ben.goto(`/${event.slug}`)
  await ben.locator('input[name="isAttending"][value="true"]').check()
  await expect(ben.getByRole('checkbox', { name: /^Salat/ })).toBeDisabled()
  await expect(ben.getByText('(1/1, vergeben)')).toBeVisible()
  await answer(ben, event.slug, 'Ben', ['Getränke'])
  expect(await claimsOf(event.id)).toEqual({ Salat: ['Anna'], Getränke: ['Anna', 'Ben'] })

  // Am gesperrten Feld vorbei (DOM manipuliert): der Server vergibt keinen vollen Eintrag
  const cem = await browser.newPage()
  await cem.goto(`/${event.slug}`)
  await cem.getByLabel('Dein Name').fill('Cem')
  await cem.locator('input[name="isAttending"][value="true"]').check()
  await cem.locator('input[name="bringSlot"]').evaluateAll(inputs => inputs.forEach(i => { (i as HTMLInputElement).disabled = false; (i as HTMLInputElement).checked = true }))
  await cem.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(cem.getByText('Deine Rückmeldung wurde erfolgreich gespeichert.')).toBeVisible()
  expect(await claimsOf(event.id)).toEqual({ Salat: ['Anna'], Getränke: ['Anna', 'Ben'] })

  // Gästeliste und Verwaltung
  const visitor = await browser.newPage()
  await visitor.goto(`/${event.slug}`)
  await expect(visitor.getByText('🍕 Bringt mit: Salat, Getränke')).toBeVisible()
  const admin = await browser.newPage()
  await login(admin, owner.email)
  await admin.goto(`/admin/events/${event.id}`)
  await expect(admin.getByTestId('bring-summary').locator('li')).toHaveText([/Salat\s*1\/1/, /Getränke\s*2\/2/])
  const csv = await (await admin.request.get(`/api/export?eventId=${event.id}`, { headers: await cookieHeader(admin.context()) })).text()
  expect(csv).toContain('Salat, Getränke')

  // Anna sagt über ihren persönlichen Link ab: alles wieder frei
  const annaRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id, participant: { name: 'Anna' } }, include: { participant: true } })
  await anna.goto(`/${event.slug}?token=${annaRsvp.participant.editToken}`)
  await anna.locator('input[name="isAttending"][value="false"]').check()
  await anna.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(anna.getByText('Deine Absage wurde erfolgreich gespeichert.')).toBeVisible()
  expect(await claimsOf(event.id)).toEqual({ Salat: [], Getränke: ['Ben'] })

  // Löschen der Antwort nimmt die Beanspruchungen mit
  const benRsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventId: event.id, participant: { name: 'Ben' } } })
  await prisma.rsvp.delete({ where: { id: benRsvp.id } })
  expect(await prisma.bringClaim.count({ where: { rsvpId: benRsvp.id } })).toBe(0)
})

test('gleichzeitige Zusagen: höchstens so viele wie vorgesehen; Warteliste hält nichts', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  const slot = await prisma.bringSlot.create({ data: { eventId: event.id, label: 'Kuchen', quantity: 2, position: 0 } })
  const rsvps = await Promise.all(Array.from({ length: 6 }, (_, i) => createRsvp(event, { isAttending: true, name: `Gast ${i}` })))
  await Promise.all(rsvps.map(r => syncBringClaims(r.rsvp.id, event.id, [slot.id], true)))
  expect(await prisma.bringClaim.count({ where: { slotId: slot.id } })).toBe(2)

  // Warteliste: Termin mit einem Platz, die zweite Zusage landet auf der Warteliste und bekommt nichts
  const small = await createEvent(owner, { maxCapacity: 1 })
  await prisma.bringSlot.create({ data: { eventId: small.id, label: 'Brot', quantity: 5, position: 0 } })
  await answer(page, small.slug, 'Erste', ['Brot'])
  const second = await page.context().browser()!.newPage()
  await second.goto(`/${small.slug}`)
  await second.getByLabel('Dein Name').fill('Zweite')
  await second.locator('input[name="isAttending"][value="true"]').check()
  await second.getByRole('checkbox', { name: /^Brot/ }).check()
  await second.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(second.getByText(/Warteliste/).first()).toBeVisible()
  expect(await claimsOf(small.id)).toEqual({ Brot: ['Erste'] })
})
