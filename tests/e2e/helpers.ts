import { createHash, createHmac, randomBytes } from 'node:crypto'
import { PrismaClient, type Event, type EventSeries, type GuestUser, type Role, type User } from '@prisma/client'
import { expect, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import { hashPassword } from '../../app/lib/password'
import { BASE_URL, TEST_POLL_SECRET } from '../../playwright.config'

export { BASE_URL, TEST_POLL_SECRET }

export const prisma = new PrismaClient()

export const PASSWORD = 'ein sicheres Testpasswort'

// Der Server läuft mit NODE_ENV=production (next start) - also mit __Host-Cookies.
export const SESSION_COOKIE = '__Host-session'
export const GUEST_SESSION_COOKIE = '__Host-guest-session'
const HOST = new URL(BASE_URL).hostname

let counter = 0
/** Eindeutige Kennung pro Aufruf, damit sich Tests nicht über Konten, Slugs oder Drossel-Zähler beeinflussen. */
export function unique(): string {
  return `${Date.now().toString(36)}${(counter++).toString(36)}`
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${unique()}@example.test`
}

// Zufälliger Startwert pro Prozess: Nach einem fehlgeschlagenen Test startet Playwright einen
// neuen Worker - ein bei 0 beginnender Zähler würde dann IPs wiederverwenden, die ein
// Drossel-Test absichtlich gesperrt hat.
let ipCounter = Math.floor(Math.random() * 60_000)
/** Eindeutige Besucher-IP (Benchmark-Netz 198.18.0.0/15, RFC 2544 - nie echte Besucher). */
export function uniqueIp(): string {
  ipCounter++
  return `198.${18 + (Math.floor(ipCounter / 62_500) % 2)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Schlüssel einer Zeile in LoginThrottle, wie app/lib/throttle.ts ihn bildet. */
export function throttleKey(scope: string, identifier: string): string {
  return sha256(`${scope}\u0000${identifier}`)
}

// bcrypt mit Kosten 12 dauert spürbar - der Hash des Standard-Passworts wird einmal berechnet
// und für alle Testkonten wiederverwendet.
let defaultHash: Promise<string> | undefined
function passwordHashFor(password: string): Promise<string> {
  if (password !== PASSWORD) return hashPassword(password)
  return (defaultHash ??= hashPassword(PASSWORD))
}

/** Admin-seitiges Konto (User). `password: null` = Konto ohne Passwort (nur über den Konten-Verbund). */
export async function createAccount(role: Role = 'CREATOR', options: { password?: string | null; email?: string } = {}): Promise<User> {
  const password = options.password === undefined ? PASSWORD : options.password
  return prisma.user.create({
    data: {
      email: options.email ?? uniqueEmail(role.toLowerCase()),
      role,
      passwordHash: password === null ? null : await passwordHashFor(password)
    }
  })
}

/** Gast-seitiges Nutzer-Konto (GuestUser), standardmäßig bereits bestätigt. */
export async function createGuestUser(options: { verified?: boolean; password?: string; email?: string } = {}): Promise<GuestUser> {
  return prisma.guestUser.create({
    data: {
      email: options.email ?? uniqueEmail('gast'),
      name: 'Gast ' + unique(),
      passwordHash: await passwordHashFor(options.password ?? PASSWORD),
      isVerified: options.verified ?? true
    }
  })
}

// Ein schlankes Formular (nur Name + Zu-/Absage), damit Tests es ohne Pflichtfelder abschicken können.
const MINIMAL_FORM = JSON.stringify({ askEmail: false, askPhone: false, askDiet: false, askAlcohol: false })

export async function createEvent(owner: User, data: Partial<Omit<Event, 'id' | 'ownerId'>> = {}): Promise<Event> {
  return prisma.event.create({
    data: {
      slug: 'e2e-' + unique(),
      title: 'Testevent ' + unique(),
      date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      formConfig: MINIMAL_FORM,
      ...data,
      ownerId: owner.id
    }
  })
}

export async function createSeries(owner: User, data: Partial<Omit<EventSeries, 'id' | 'ownerId'>> = {}): Promise<EventSeries> {
  return prisma.eventSeries.create({
    data: { slug: 'reihe-' + unique(), title: 'Testreihe ' + unique(), askDiet: false, ...data, ownerId: owner.id }
  })
}

/** Termin einer Reihe - der Owner kommt wie in addTerminToSeries immer von der Reihe. */
export async function createTermin(series: EventSeries, data: Partial<Omit<Event, 'id' | 'ownerId' | 'seriesId'>> = {}): Promise<Event> {
  return prisma.event.create({
    data: {
      slug: 'termin-' + unique(),
      title: 'Termin ' + unique(),
      date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      formConfig: MINIMAL_FORM,
      ...data,
      ownerId: series.ownerId,
      seriesId: series.id
    }
  })
}

/** Legt direkt in der Datenbank eine Antwort samt Participant an (wie nach einem abgeschickten Formular). */
export async function createRsvp(
  event: Event,
  options: { isAttending?: boolean; isOnWaitlist?: boolean; guestUserId?: string; participantId?: string; name?: string } = {}
) {
  const participant = options.participantId
    ? await prisma.participant.findUniqueOrThrow({ where: { id: options.participantId } })
    : await prisma.participant.create({
        data: { name: options.name ?? 'Teilnehmer ' + unique(), seriesId: event.seriesId, guestUserId: options.guestUserId ?? null }
      })
  const rsvp = await prisma.rsvp.create({
    data: {
      eventId: event.id,
      participantId: participant.id,
      isAttending: options.isAttending ?? true,
      isOnWaitlist: options.isOnWaitlist ?? false
    }
  })
  return { participant, rsvp }
}

/** Klartext-API-Token für die Client-API (app/api/v1/) - gespeichert wird wie in der App nur der Hash. */
export async function createApiToken(guestUser: GuestUser): Promise<string> {
  const token = 'rsvp_' + randomBytes(32).toString('hex')
  await prisma.guestApiToken.create({ data: { name: 'E2E', tokenHash: sha256(token), guestUserId: guestUser.id } })
  return token
}

/**
 * Gast-Sitzung direkt anlegen (ohne Login-Formular) - z.B. für ein noch unbestätigtes Konto, das
 * sich über das Formular gar nicht anmelden dürfte. Setzt das Cookie im Browser-Kontext.
 */
export async function plantGuestSession(context: BrowserContext, guestUser: GuestUser): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await prisma.guestSession.create({
    data: { token: sha256(token), guestUserId: guestUser.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
  })
  await context.addCookies([{ name: GUEST_SESSION_COOKIE, value: token, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }])
  return token
}

/** Setzt das Freischalt-Cookie einer Event- bzw. Reihen-PIN, wie es verifyEventPin tut. */
export async function unlockPin(context: BrowserContext, cookieName: string, pin: string) {
  await context.addCookies([{ name: cookieName, value: pin, domain: HOST, path: '/', httpOnly: true, sameSite: 'Lax' }])
}

/**
 * Cookies des Kontexts als Header-Wert. page.request schickt Secure-Cookies (__Host-session)
 * über http://127.0.0.1 nicht von selbst mit, der Browser schon - deshalb ausdrücklich. Ohne
 * URL-Filter lesen: cookies(BASE_URL) ließe Secure-Cookies bei http ebenfalls weg.
 */
export async function cookieHeader(context: BrowserContext): Promise<Record<string, string>> {
  const cookie = (await context.cookies()).filter(c => c.domain === HOST).map(c => `${c.name}=${c.value}`).join('; ')
  return cookie ? { cookie } : {}
}

/** Meldet über das Admin-Formular an. Setzt vorher eine eigene Besucher-IP, damit Drossel-Zähler anderer Tests nicht stören. */
export async function login(page: Page, email: string, password = PASSWORD, ip = uniqueIp()) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
  await page.goto('/admin/login')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Einloggen' }).click()
  // Auf das Ergebnis warten (Weiterleitung oder Fehlermeldung) - ein sofort folgendes
  // page.goto würde die laufende Server Action sonst abbrechen.
  await page.waitForURL(url => url.pathname !== '/admin/login' || url.searchParams.has('error'))
}

/** Wie login(), aber für Nutzer-Konten (GuestUser) über /mein-konto/login. */
export async function guestLogin(page: Page, email: string, password = PASSWORD, ip = uniqueIp(), next?: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
  await page.goto(next === undefined ? '/mein-konto/login' : `/mein-konto/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Einloggen' }).click()
  await page.waitForURL(url => url.pathname !== '/mein-konto/login' || url.searchParams.has('error'))
}

export type ReplayableForm = { url: string; fields: [string, string][] }

/**
 * Liest ein Server-Action-Formular aus, um es später (verändert, von einem anderen Konto
 * oder ohne Sitzung) erneut abzuschicken. WICHTIG: nur direkt nach einem frischen
 * Seitenaufruf - nach einer Client-Navigation fehlt das serverseitig gerenderte
 * $ACTION_ID-Feld und der Test würde nichts prüfen.
 */
export async function readForm(page: Page, selector: string): Promise<ReplayableForm> {
  await page.reload()
  const fields = await page.locator(selector).first().evaluate((form: HTMLFormElement) =>
    [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''] as [string, string])
  )
  expect(fields.some(([name]) => name.startsWith('$ACTION_ID_')), 'Formular hat keine $ACTION_ID').toBe(true)
  return { url: page.url(), fields }
}

/**
 * Schickt ein zuvor gelesenes Formular ab, wie es ein Browser ohne JavaScript täte
 * (multipart, Origin der App). `overrides` ersetzt einzelne Felder. Die Cookies des
 * Kontexts gehen ausdrücklich mit (siehe cookieHeader).
 */
export async function submitForm(
  page: Page,
  form: ReplayableForm,
  overrides: Record<string, string> = {},
  headers: Record<string, string> = {}
): Promise<APIResponse> {
  const multipart: Record<string, string> = {}
  for (const [name, value] of form.fields) multipart[name] = name in overrides ? overrides[name] : value
  for (const [name, value] of Object.entries(overrides)) multipart[name] = value
  return page.request.post(form.url, {
    multipart,
    headers: { origin: BASE_URL, 'x-forwarded-for': uniqueIp(), ...(await cookieHeader(page.context())), ...headers },
    maxRedirects: 0
  })
}

/** Hinweisbox der Seite (ohne den unsichtbaren Route-Announcer von Next.js, der ebenfalls role="alert" hat). */
export function pageAlert(page: Page) {
  return page.getByRole('main').getByRole('alert')
}

/** Ziel einer Weiterleitung als URL (relativ zur App aufgelöst). */
export function locationOf(response: APIResponse): URL | null {
  const location = response.headers()['location']
  return location ? new URL(location, BASE_URL) : null
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Signiert einen Token im Format der Kopplung mit dem Abstimmungstool
 * (`base64url(JSON).base64url(HMAC-SHA256(payloadPart))`) - bewusst unabhängig von
 * app/lib/poll-verification.ts nachgebaut, damit die Tests das vereinbarte Format prüfen
 * und nicht nur die eigene Implementierung gegen sich selbst.
 */
export function signCouplingToken(payload: object, secret = TEST_POLL_SECRET): string {
  const payloadPart = base64url(JSON.stringify(payload))
  return `${payloadPart}.${base64url(createHmac('sha256', secret).update(payloadPart).digest())}`
}

export function decodeCouplingToken(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}
