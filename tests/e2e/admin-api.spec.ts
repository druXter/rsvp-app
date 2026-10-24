import { randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { Event, User } from '@prisma/client'
import {
  createAccount, createApiToken, createEvent, createGuestUser, createRsvp, createSeries, createTermin, login, prisma, sha256
} from './helpers'

// Lesende Verwaltungs-API (app/api/v1/verwaltung/, UserApiToken): genau die Rechte der Oberfläche, nur lesen.

async function adminToken(user: User): Promise<string> {
  const token = 'rsvpv_' + randomBytes(32).toString('hex')
  await prisma.userApiToken.create({ data: { name: 'E2E', tokenHash: sha256(token), userId: user.id } })
  return token
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

/** Termin mit Gang "Wurst" und zwei Zusagen (eine davon mit Allergie). */
async function sausageEvent(event: Event) {
  const course = await prisma.menuCourse.create({ data: { eventId: event.id, label: 'Wurst', options: JSON.stringify(['0', '1', '2']), position: 0 } })
  const a = await createRsvp(event, { name: 'Anna' })
  await prisma.rsvpPerson.create({ data: { rsvpId: a.rsvp.id, position: 0, name: 'Anna', isAttending: true, allergies: 'Senf', menuChoices: { create: { courseId: course.id, option: '2' } } } })
  const b = await createRsvp(event, { name: 'Ben' })
  await prisma.rsvpPerson.create({ data: { rsvpId: b.rsvp.id, position: 0, name: 'Ben', isAttending: true, menuChoices: { create: { courseId: course.id, option: '2' } } } })
  await createRsvp(event, { name: 'Absage', isAttending: false })
  return course
}

async function kitchen(request: APIRequestContext, token: string, eventId: string) {
  return request.get(`/api/v1/verwaltung/termine/${eventId}/kueche`, { headers: auth(token) })
}

test.describe('Verwaltungs-API', () => {
  test('Moderator mit Freigabe der Reihe: Küchenübersicht mit Wurst-Zählung, ohne Allergien pro Person', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const moderator = await createAccount('MODERATOR')
    const series = await createSeries(owner)
    const termin = await createTermin(series)
    await sausageEvent(termin)
    await prisma.resourceAccess.create({ data: { userId: moderator.id, seriesId: series.id } })
    const token = await adminToken(moderator)

    const response = await kitchen(request, token, termin.id)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    const body = await response.json()
    expect(body.termin).toMatchObject({ id: termin.id, series: { id: series.id } })
    expect(body.courses).toEqual([expect.objectContaining({
      label: 'Wurst',
      counts: [
        { option: '0', adults: 0, children: 0, total: 0 },
        { option: '1', adults: 0, children: 0, total: 0 },
        { option: '2', adults: 2, children: 0, total: 2 }
      ],
      missing: 0
    })])
    expect(body.persons.map((p: { name: string }) => p.name).sort()).toEqual(['Anna', 'Ben'])
    expect(body.persons[0].menu).toEqual([expect.objectContaining({ course: 'Wurst', option: '2' })])
    expect(body.personsWithAllergies).toBe(1)
    expect(JSON.stringify(body)).not.toContain('Senf')

    // Terminliste: derselbe Termin, mit Summen und Gängen.
    const list = await (await request.get('/api/v1/verwaltung/termine', { headers: auth(token) })).json()
    const entry = list.termine.find((t: { id: string }) => t.id === termin.id)
    expect(entry).toMatchObject({ isOwner: false, responses: { yes: 2, no: 1, waitlist: 0 }, menu: [{ label: 'Wurst', options: ['0', '1', '2'] }] })
  })

  test('fremde Termine: 404 und nicht in der Liste; entzogene Freigabe wirkt sofort', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const moderator = await createAccount('MODERATOR')
    const shared = await createEvent(owner)
    const foreign = await createEvent(owner)
    await sausageEvent(foreign)
    const access = await prisma.resourceAccess.create({ data: { userId: moderator.id, eventId: shared.id } })
    const token = await adminToken(moderator)

    expect((await kitchen(request, token, foreign.id)).status()).toBe(404)
    expect((await kitchen(request, token, 'gibt-es-nicht')).status()).toBe(404)
    const ids = (await (await request.get('/api/v1/verwaltung/termine', { headers: auth(token) })).json()).termine.map((t: { id: string }) => t.id)
    expect(ids).toContain(shared.id)
    expect(ids).not.toContain(foreign.id)

    // Positivkontrolle: freigegebener Termin geht - bis die Freigabe entzogen wird.
    expect((await kitchen(request, token, shared.id)).status()).toBe(200)
    await prisma.resourceAccess.delete({ where: { id: access.id } })
    expect((await kitchen(request, token, shared.id)).status()).toBe(404)
  })

  test('Owner sieht die eigenen Termine, ein Konto mit Admin-Rolle alle', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const other = await createAccount('CREATOR')
    const admin = await createAccount('ADMIN')
    const own = await createEvent(owner)
    const othersEvent = await createEvent(other)

    const ownerToken = await adminToken(owner)
    expect((await kitchen(request, ownerToken, own.id)).status()).toBe(200)
    expect((await kitchen(request, ownerToken, othersEvent.id)).status()).toBe(404)

    const adminTokenValue = await adminToken(admin)
    expect((await kitchen(request, adminTokenValue, othersEvent.id)).status()).toBe(200)
    const list = await (await request.get('/api/v1/verwaltung/termine', { headers: auth(adminTokenValue) })).json()
    expect(list.termine.find((t: { id: string }) => t.id === othersEvent.id)).toMatchObject({ isOwner: true })
  })

  test('Gast-Token und Verwaltungs-Token sind nicht austauschbar; ohne gültigen Token 401', async ({ request }) => {
    const owner = await createAccount('CREATOR')
    const event = await createEvent(owner)
    const guestToken = await createApiToken(await createGuestUser())
    const token = await adminToken(owner)

    for (const bad of [guestToken, 'rsvpv_' + 'a'.repeat(64), '']) {
      expect((await kitchen(request, bad, event.id)).status(), bad).toBe(401)
      expect((await request.get('/api/v1/verwaltung/me', { headers: auth(bad) })).status(), bad).toBe(401)
    }
    expect((await request.get(`/api/v1/verwaltung/termine/${event.id}/kueche`)).status()).toBe(401)
    // Der Verwaltungs-Token öffnet die Gast-API nicht ...
    expect((await request.get('/api/v1/me', { headers: auth(token) })).status()).toBe(401)
    // ... aber die Verwaltungs-API (Positivkontrolle), und lastUsedAt wird gepflegt.
    const me = await request.get('/api/v1/verwaltung/me', { headers: auth(token) })
    expect(me.status()).toBe(200)
    expect(await me.json()).toMatchObject({ email: owner.email, role: 'CREATOR' })
    expect((await prisma.userApiToken.findFirstOrThrow({ where: { userId: owner.id } })).lastUsedAt).not.toBeNull()
  })

  test('Token über die Konto-Seite: einmal angezeigt, nur als Hash gespeichert, widerrufbar', async ({ page, request }) => {
    const owner = await createAccount('CREATOR')
    await login(page, owner.email)
    await page.goto('/admin/account')
    await page.getByLabel('Neuen Token erzeugen').fill('Discord-Bot')
    await page.getByRole('button', { name: 'Token erzeugen' }).click()
    await page.waitForURL(/tokenCreated=1/)
    const token = (await page.getByTestId('new-admin-api-token').textContent())!.trim()
    expect(token).toMatch(/^rsvpv_[0-9a-f]{64}$/)
    const stored = await prisma.userApiToken.findFirstOrThrow({ where: { userId: owner.id } })
    expect(stored).toMatchObject({ name: 'Discord-Bot', tokenHash: sha256(token) })
    expect((await request.get('/api/v1/verwaltung/me', { headers: auth(token) })).status()).toBe(200)

    await page.getByRole('list', { name: 'API-Tokens' }).getByRole('button', { name: 'Widerrufen' }).click()
    await page.waitForURL(/tokenRevoked=1/)
    expect(await prisma.userApiToken.count({ where: { userId: owner.id } })).toBe(0)
    expect((await request.get('/api/v1/verwaltung/me', { headers: auth(token) })).status()).toBe(401)
  })

  test('fremde Tokens lassen sich nicht widerrufen', async ({ page }) => {
    const owner = await createAccount('CREATOR')
    const victim = await createAccount('CREATOR')
    await adminToken(victim)
    const victimToken = await prisma.userApiToken.findFirstOrThrow({ where: { userId: victim.id } })
    await adminToken(owner)

    await login(page, owner.email)
    await page.goto('/admin/account')
    // Formular des eigenen Tokens mit der ID des fremden abschicken.
    await page.getByRole('list', { name: 'API-Tokens' }).locator('input[name="tokenId"]').evaluate((input: HTMLInputElement, id) => { input.value = id }, victimToken.id)
    await page.getByRole('list', { name: 'API-Tokens' }).getByRole('button', { name: 'Widerrufen' }).click()
    await page.waitForURL(/tokenRevoked=1/)
    expect(await prisma.userApiToken.count({ where: { id: victimToken.id } })).toBe(1)
    // Positivkontrolle: der eigene Token ist noch da und lässt sich widerrufen.
    expect(await prisma.userApiToken.count({ where: { userId: owner.id } })).toBe(1)
    await page.getByRole('list', { name: 'API-Tokens' }).getByRole('button', { name: 'Widerrufen' }).click()
    await expect.poll(() => prisma.userApiToken.count({ where: { userId: owner.id } })).toBe(0)
  })
})
