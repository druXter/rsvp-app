// app/lib/guest-auth.ts
import { GuestUser } from '@prisma/client'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { generateToken, hashToken } from './tokens'

// __Host-Präfix wie beim Admin-Login (Begründung siehe app/lib/auth.ts).
export const GUEST_SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-guest-session' : 'guest_session_token'
export const GUEST_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 Tage, wie beim Admin-Login

export function guestSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/**
 * Liest die aktuelle Gast-Session anhand des Cookie-Tokens aus der Datenbank. Strikt
 * getrenntes Cookie/Modell vom Admin-Login (siehe app/lib/auth.ts), damit Gast- und
 * Admin-Sessions nie verwechselt werden können. In der Datenbank steht nur der Token-Hash.
 */
export async function getCurrentGuestUser(): Promise<GuestUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(GUEST_SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.guestSession.findUnique({ where: { token: hashToken(token) }, include: { guestUser: true } })
  if (!session || session.expiresAt < new Date()) return null

  return session.guestUser
}

/**
 * Wie getCurrentGuestUser(), wirft aber statt null zurückzugeben.
 */
export async function requireGuestUser(): Promise<GuestUser> {
  const guestUser = await getCurrentGuestUser()
  if (!guestUser) throw new Error('Nicht eingeloggt')
  return guestUser
}

/**
 * Legt eine neue Gast-Sitzung an und gibt deren Klartext-Token zurück. Verwirft eine vorhandene
 * Sitzung dieses Browsers (Session-Fixation) und räumt abgelaufene auf; hält lastLoginAt aktuell,
 * damit die automatische Löschung inaktiver Konten (app/api/cron/cleanup/route.ts) echte
 * Inaktivität misst. Das Cookie setzt der Aufrufer - Server Actions über createGuestSession, Route
 * Handler direkt an ihrer Response (wie issueSession in app/lib/auth.ts).
 */
export async function issueGuestSession(guestUserId: string): Promise<string> {
  const previous = (await cookies()).get(GUEST_SESSION_COOKIE)?.value
  if (previous) await prisma.guestSession.deleteMany({ where: { token: hashToken(previous) } })
  await prisma.guestSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const token = generateToken()
  await prisma.guestSession.create({
    data: { token: hashToken(token), guestUserId, expiresAt: new Date(Date.now() + GUEST_SESSION_DURATION_MS) }
  })
  await prisma.guestUser.update({ where: { id: guestUserId }, data: { lastLoginAt: new Date() } })
  return token
}

/** Für Server Actions: neue Gast-Sitzung anlegen UND das Cookie setzen. */
export async function createGuestSession(guestUserId: string): Promise<void> {
  const token = await issueGuestSession(guestUserId)
  ;(await cookies()).set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions(GUEST_SESSION_DURATION_MS / 1000))
}

/**
 * Gast-Sitzung für das mit einem Verwaltungskonto verknüpfte Teilnehmendenkonto (User.linkedGuestUserId),
 * aufgerufen nach jedem erfolgreichen Verwaltungs-Login. Nur für bestätigte Konten - dieselbe Regel wie
 * beim Gast-Login. Gibt den Token zurück (oder null, wenn nichts verknüpft ist); das Cookie setzt der
 * Aufrufer wie bei issueGuestSession. Die Gegenrichtung gibt es bewusst nicht (siehe schema.prisma).
 */
export async function issueLinkedGuestSession(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { linkedGuestUser: { select: { id: true, isVerified: true } } } })
  const guestUser = user?.linkedGuestUser
  if (!guestUser?.isVerified) return null
  return issueGuestSession(guestUser.id)
}

/** Für Server Actions: wie issueLinkedGuestSession, setzt aber gleich das Cookie. */
export async function createLinkedGuestSession(userId: string): Promise<void> {
  const token = await issueLinkedGuestSession(userId)
  if (token) (await cookies()).set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions(GUEST_SESSION_DURATION_MS / 1000))
}

/**
 * Beim Abmelden aus der Verwaltung: beendet auch die Gast-Sitzung dieses Browsers, aber nur, wenn sie
 * zum verknüpften Teilnehmendenkonto gehört - die Sitzung einer anderen Person bleibt unberührt.
 */
export async function destroyLinkedGuestSession(linkedGuestUserId: string | null): Promise<void> {
  if (!linkedGuestUserId) return
  const guestUser = await getCurrentGuestUser()
  if (guestUser?.id === linkedGuestUserId) await destroyGuestSession()
}

export async function destroyGuestSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(GUEST_SESSION_COOKIE)?.value
  if (token) await prisma.guestSession.deleteMany({ where: { token: hashToken(token) } })
  cookieStore.set(GUEST_SESSION_COOKIE, '', { ...guestSessionCookieOptions(0), maxAge: 0 })
}
