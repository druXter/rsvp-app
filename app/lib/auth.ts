// app/lib/auth.ts
import { User } from '@prisma/client'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { generateToken, hashToken } from './tokens'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Das `__Host-`-Präfix erzwingt Secure, Path=/ und KEIN Domain-Attribut: Der Browser akzeptiert
 * das Cookie dann nur von genau diesem Host. Die Tools der Suite laufen auf Subdomains derselben
 * Domain - ohne das Präfix könnte eine andere Subdomain ein Session-Cookie für diese hier setzen
 * oder überschreiben (Cookie-Tossing). In der Entwicklung über http://localhost ist das Präfix
 * nicht nutzbar, dort gilt der bisherige Name.
 */
export const SESSION_COOKIE = isProduction ? '__Host-session' : 'session_token'
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 Tage

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true, // Schützt vor Cross-Site-Scripting (XSS)
    secure: isProduction, // Überträgt Cookies in Produktion nur über HTTPS
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/**
 * Liest die aktuelle Session anhand des Cookie-Tokens aus der Datenbank. Das Cookie selbst
 * enthält nur den opaken Token - wer eingeloggt ist, ergibt sich ausschließlich aus diesem
 * Server-seitigen Lookup. In der Datenbank steht nur der Hash des Tokens (siehe tokens.ts).
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({ where: { token: hashToken(token) }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) return null

  return session.user
}

/**
 * Wie getCurrentUser(), wirft aber statt null zurückzugeben - für den Einsatz in
 * Server Actions, die ohnehin nur eingeloggt aufgerufen werden dürfen.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Nicht autorisiert')

  return user
}

/**
 * Legt eine neue Sitzung in der Datenbank an und gibt deren Klartext-Token zurück. Eine bereits
 * vorhandene Sitzung dieses Browsers wird dabei verworfen (Schutz vor Session-Fixation: nach dem
 * Login gilt nie ein Token, den der Browser schon vorher hatte). Abgelaufene Sitzungen werden bei
 * dieser Gelegenheit aufgeräumt. Das Cookie setzt der Aufrufer - Server Actions über
 * createSession, Route Handler direkt an ihrer Response.
 */
export async function issueSession(userId: string): Promise<string> {
  const previous = (await cookies()).get(SESSION_COOKIE)?.value
  if (previous) await prisma.session.deleteMany({ where: { token: hashToken(previous) } })
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const token = generateToken()
  await prisma.session.create({
    data: { token: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) }
  })
  return token
}

/** Für Server Actions: neue Sitzung anlegen UND das Cookie setzen. */
export async function createSession(userId: string): Promise<void> {
  const token = await issueSession(userId)
  ;(await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_DURATION_MS / 1000))
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) await prisma.session.deleteMany({ where: { token: hashToken(token) } })
  cookieStore.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 })
}
