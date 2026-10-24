import { expect, test } from '@playwright/test'
import {
  BASE_URL, createAccount, createEvent, createRsvp, locationOf, prisma, readForm, submitForm, uniqueEmail, uniqueIp, withFreshPow
} from './helpers'

// Bot-Schutz (ProofOfWork aus suite-kit): neue Antworten ohne Konto und die Registrierung brauchen eine gültige,
// unverbrauchte Lösung. Änderungen per Bearbeitungs-Link nicht. Jeder Fall mit Positivkontrolle.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: false, askBringingItem: false, askAllergies: false })
const POW_MESSAGE = 'Die Sicherheitsprüfung hat nicht geklappt'

test('Antwort ohne Konto: im Browser unbemerkt, nachgespielt nur mit frischer Lösung', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM })
  // Die Aufgabe kommt verzögert: Wer vorher abschickt, sieht den Hinweis, danach geht die Antwort von selbst ab.
  await page.route('**/api/suite/pow', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.goto(`/${event.slug}`)
  await page.getByLabel('Dein Name').fill('Mensch')
  await page.locator('input[name="isAttending"][value="true"]').check()
  const captured = page.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'])
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Einen Moment, Sicherheitsprüfung läuft')).toBeVisible()
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const request = await captured

  const replay = (body: string) => page.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL, 'x-forwarded-for': uniqueIp() },
    data: body
  })
  const original = request.postDataBuffer()!.toString('utf8')
  const bot = original.replace('Mensch', 'Bot')
  const without = bot.replace(/(name="(?:_?\d+_)?pow"\r\n\r\n)[^\r]*/, '$1')
  for (const body of [bot, without]) expect(await (await replay(body)).text()).toContain(POW_MESSAGE)
  expect(await prisma.participant.count({ where: { name: 'Bot' } })).toBe(0)

  // Positivkontrolle
  expect(await (await replay(await withFreshPow(page, bot))).text()).not.toContain(POW_MESSAGE)
  expect(await prisma.participant.count({ where: { name: 'Bot' } })).toBe(1)
})

test('Änderung per Bearbeitungs-Link braucht keine Lösung', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM })
  const { participant } = await createRsvp(event, { name: 'Erika' })
  // Ohne Aufgabe (Endpunkt nicht erreichbar) geht die Änderung trotzdem durch.
  await page.route('**/api/suite/pow', route => route.abort())
  await page.goto(`/${event.slug}?token=${participant.editToken}`)
  await page.getByLabel('Dein Name').fill('Erika Neu')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(async () => (await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).name).toBe('Erika Neu')
})

test('Registrierung: ohne gültige Lösung kein Konto und keine Mail', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await page.goto(`/${event.slug}/registrieren`)
  const form = await readForm(page, 'form:has(input[name="eventId"])')
  const fields = (email: string) => ({ name: 'Neu', email, password: 'ein sicheres Passwort' })

  for (const pow of ['', 'irgendwas']) {
    const email = uniqueEmail('bot')
    const response = await submitForm(page, form, { ...fields(email), pow })
    expect(locationOf(response)?.searchParams.get('error')).toBe('pow')
    expect(await prisma.guestUser.findUnique({ where: { email } })).toBeNull()
  }
  await page.goto(`/${event.slug}/registrieren?error=pow`)
  await expect(page.getByRole('alert').filter({ hasText: POW_MESSAGE })).toBeVisible()

  // Positivkontrolle: submitForm holt eine frische Lösung.
  const email = uniqueEmail('mensch')
  expect(locationOf(await submitForm(page, form, fields(email)))?.pathname).toBe('/mein-konto/login')
  expect(await prisma.guestUser.findUnique({ where: { email } })).not.toBeNull()
})
