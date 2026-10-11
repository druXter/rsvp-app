import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import { BASE_URL, cookieHeader, createAccount, createEvent, createRsvp, login, prisma } from './helpers'

// Wunschliste (Idee N4, docs/KONZEPT-WUNSCHLISTE.md): Wünsche im Reiter "Wünsche", Reservieren nur mit
// persönlichem Link nach einer Antwort, Stückzahl atomar begrenzt (auch bei gleichzeitigen Reservierungen),
// Geldwünsche mit Teilbeträgen, "Überraschung" verbirgt die Namen vor der Verwaltung.

const FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: false, askAllergies: false })

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

/** Antwortet als neuer Gast und bleibt auf dem persönlichen Link (dort steht die Wunschliste zum Reservieren). */
async function answerAs(page: Page, slug: string, name: string) {
  await page.goto(`/${slug}`)
  await page.getByLabel('Dein Name').fill(name)
  await page.locator('input[name="isAttending"][value="true"]').check()
  await page.getByRole('button', { name: 'Antwort absenden' }).click()
  await expect(page.getByText('Danke für deine Anmeldung!')).toBeVisible()
  const participant = await prisma.participant.findFirstOrThrow({ where: { name, rsvps: { some: { event: { slug } } } } })
  await page.goto(`/${slug}?token=${participant.editToken}`)
  return participant
}

const wishItem = (page: Page, title: string) => page.getByTestId('wish').filter({ hasText: title })

test('Wünsche anlegen, reservieren, Geldwunsch mit Teilbeträgen, Überraschung', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM })
  await login(page, owner.email)

  // Einschalten in den Einstellungen, dann der Reiter "Wünsche"
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await page.getByText('Wunschliste', { exact: true }).click()
  await page.getByLabel('🎁 Wunschliste auf der Gästeseite').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(/gespeichert=1/)
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ wishlist: true, wishesSecret: true })
  await page.getByRole('link', { name: 'Wünsche' }).click()

  const add = async (fields: Record<string, string>, money = false) => {
    if (money) await page.getByRole('radio', { name: 'Geldwunsch (Teilbeträge)' }).first().check()
    else await page.getByRole('radio', { name: 'Geschenk' }).first().check()
    for (const [label, value] of Object.entries(fields)) await page.locator(`#new-${label}`).fill(value)
    const before = await prisma.wish.count({ where: { eventId: event.id } })
    await page.getByRole('button', { name: 'Wunsch hinzufügen' }).click()
    await expect.poll(() => prisma.wish.count({ where: { eventId: event.id } })).toBe(before + 1)
  }
  await add({ title: 'Kaffeemaschine', price: '120', url: 'https://shop.example.test/kaffee' })
  await add({ title: 'Weingläser', quantity: '6' })
  await add({ title: 'Hochzeitsreise', target: '2000', description: 'Portugal' }, true)
  // Geldwunsch ohne Zielbetrag: Fehlermeldung, nichts angelegt
  await page.getByRole('radio', { name: 'Geldwunsch (Teilbeträge)' }).first().check()
  await page.locator('#new-title').fill('Ohne Ziel')
  await page.locator('#new-target').fill('abc')
  await page.getByRole('button', { name: 'Wunsch hinzufügen' }).click()
  await expect(page.locator('form p[role="alert"]')).toContainText('kein gültiger Betrag')
  expect(await prisma.wish.count({ where: { eventId: event.id } })).toBe(3)

  // Ohne Antwort: nur ansehen
  const visitor = await newPage(browser)
  await visitor.goto(`/${event.slug}`)
  await expect(visitor.getByTestId('wishlist')).toContainText('Reservieren kannst du, sobald du geantwortet hast')
  await expect(visitor.getByTestId('wishlist').getByRole('button')).toHaveCount(0)

  // Anna reserviert die Kaffeemaschine und 4 Gläser, gibt 50 € zur Reise
  const anna = await newPage(browser)
  await answerAs(anna, event.slug, 'Anna')
  await wishItem(anna, 'Kaffeemaschine').getByRole('button', { name: 'Ich schenke das' }).click()
  await expect(wishItem(anna, 'Kaffeemaschine').getByTestId('wish-mine')).toContainText('Du schenkst das')
  await wishItem(anna, 'Weingläser').getByLabel('Anzahl für Weingläser').selectOption('4')
  await wishItem(anna, 'Weingläser').getByRole('button', { name: 'Ich schenke das' }).click()
  await expect(wishItem(anna, 'Weingläser').getByTestId('wish-mine')).toContainText('4 Stück')
  await wishItem(anna, 'Hochzeitsreise').getByLabel('Betrag für Hochzeitsreise').fill('50')
  await wishItem(anna, 'Hochzeitsreise').getByRole('button', { name: 'Beitragen' }).click()
  await expect(wishItem(anna, 'Hochzeitsreise').getByTestId('wish-mine')).toContainText('50,00')

  // Ben sieht nur den Stand, nicht wer: Kaffeemaschine vergeben, noch 2 Gläser
  const ben = await newPage(browser)
  await answerAs(ben, event.slug, 'Ben')
  await expect(wishItem(ben, 'Kaffeemaschine').getByTestId('wish-status')).toContainText('vergeben')
  await expect(wishItem(ben, 'Kaffeemaschine').getByRole('button')).toHaveCount(0)
  expect(await ben.getByTestId('wishlist').textContent()).not.toContain('Anna')
  await expect(wishItem(ben, 'Weingläser').getByTestId('wish-status')).toContainText('noch 2 von 6 frei')
  await expect(wishItem(ben, 'Weingläser').getByLabel('Anzahl für Weingläser').locator('option')).toHaveCount(2)
  await wishItem(ben, 'Hochzeitsreise').getByLabel('Betrag für Hochzeitsreise').fill('100')
  await wishItem(ben, 'Hochzeitsreise').getByRole('button', { name: 'Beitragen' }).click()
  await expect(wishItem(ben, 'Hochzeitsreise').getByTestId('wish-status')).toContainText('150,00 € von 2.000,00 €')

  // Verwaltung mit Überraschung: Stand, aber keine Namen
  await page.reload()
  await expect(page.getByTestId('wish-summary')).toContainText('3 Wünsche · 1 ganz reserviert · 0 noch offen')
  await expect(page.getByTestId('admin-wish').filter({ hasText: 'Weingläser' })).toContainText('4 von 6 reserviert')
  await expect(page.getByTestId('wish-givers')).toHaveCount(0)
  expect(await page.content()).not.toContain('Anna')
  // Ohne Überraschung: Namen sichtbar
  await prisma.event.update({ where: { id: event.id }, data: { wishesSecret: false } })
  await page.reload()
  await expect(page.getByTestId('admin-wish').filter({ hasText: 'Hochzeitsreise' }).getByTestId('wish-givers')).toHaveText('Anna (50,00 €), Ben (100,00 €)')

  // Weniger Gläser als reserviert geht nicht
  const glasses = page.getByTestId('admin-wish').filter({ hasText: 'Weingläser' })
  await glasses.getByText('Bearbeiten').click()
  await glasses.getByLabel('Anzahl').fill('3')
  await glasses.getByRole('button', { name: 'Speichern' }).click()
  await expect(glasses.locator('p[role="alert"]')).toContainText('Schon 4 Stück reserviert')

  // Anna gibt die Kaffeemaschine frei, Ben kann sie nehmen
  await wishItem(anna, 'Kaffeemaschine').getByRole('button', { name: 'Aufheben' }).click()
  await expect(wishItem(anna, 'Kaffeemaschine').getByTestId('wish-mine')).toHaveCount(0)
  await ben.reload()
  await wishItem(ben, 'Kaffeemaschine').getByRole('button', { name: 'Ich schenke das' }).click()
  await expect(wishItem(ben, 'Kaffeemaschine').getByTestId('wish-mine')).toBeVisible()
  const kaffee = await prisma.wish.findFirstOrThrow({ where: { eventId: event.id, title: 'Kaffeemaschine' }, include: { reservations: { include: { participant: true } } } })
  expect(kaffee.reservations.map(r => r.participant.name)).toEqual(['Ben'])
})

test('Reservieren serverseitig: nur eigener Link mit Antwort, nie mehr als frei - auch gleichzeitig', async ({ browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { formConfig: FORM, wishlist: true })
  const wish = await prisma.wish.create({ data: { eventId: event.id, title: 'Toaster', quantity: 1, position: 0 } })
  const glasses = await prisma.wish.create({ data: { eventId: event.id, title: 'Gläser', quantity: 3, position: 1 } })
  const other = await createEvent(owner, { formConfig: FORM, wishlist: true })
  const { participant: foreign } = await createRsvp(other, { name: 'Fremd' })

  // Anna reserviert 1 Glas (Positivkontrolle), die Anfrage wird mitgeschnitten
  const anna = await newPage(browser)
  const annaParticipant = await answerAs(anna, event.slug, 'Anna')
  const captured = anna.waitForRequest(r => r.method() === 'POST' && !!r.headers()['next-action'] && (r.postData() ?? '').includes(glasses.id))
  await wishItem(anna, 'Gläser').getByRole('button', { name: 'Ich schenke das' }).click()
  await expect(wishItem(anna, 'Gläser').getByTestId('wish-mine')).toBeVisible()
  const request: Request = await captured
  const original = request.postDataBuffer()!.toString('utf8')
  const replay = async (body: string) => (await anna.request.post(request.url(), {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': request.headers()['content-type'], accept: 'text/x-component', origin: BASE_URL, ...(await cookieHeader(anna.context())) },
    data: body
  })).text()

  // Fremder Link (Gast eines anderen Events), erfundener Link, Wunsch eines anderen Events: wirkungslos
  expect(await replay(original.replaceAll(annaParticipant.editToken, foreign.editToken))).toContain('persönlichen Link')
  expect(await replay(original.replaceAll(annaParticipant.editToken, crypto.randomUUID()))).toContain('persönlichen Link')
  const otherWish = await prisma.wish.create({ data: { eventId: other.id, title: 'Fremd', quantity: 1, position: 0 } })
  expect(await replay(original.replaceAll(glasses.id, otherWish.id))).toContain('gibt es nicht mehr')
  expect(await prisma.wishReservation.count({ where: { wishId: otherWish.id } })).toBe(0)
  // Mehr Stück als vorhanden
  const quantityField = original.match(/name="[^"]*quantity"\r\n\r\n1\r\n/)
  expect(quantityField).not.toBeNull()
  expect(await replay(original.replace(quantityField![0], quantityField![0].replace('\r\n1\r\n', '\r\n4\r\n')))).toContain('1 bis 3')

  // Fünf Gäste wollen gleichzeitig den einen Toaster: genau eine Reservierung
  const guests = await Promise.all(['G1', 'G2', 'G3', 'G4', 'G5'].map(name => createRsvp(event, { name })))
  const toasterBody = original.replaceAll(glasses.id, wish.id)
  await Promise.all(guests.map(g => replay(toasterBody.replaceAll(annaParticipant.editToken, g.participant.editToken))))
  expect(await prisma.wishReservation.count({ where: { wishId: wish.id } })).toBe(1)
})
