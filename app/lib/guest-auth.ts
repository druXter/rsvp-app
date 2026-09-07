// app/lib/guest-auth.ts
import { PrismaClient, GuestUser } from '@prisma/client'
import { cookies } from 'next/headers'

const prisma = new PrismaClient()

export const GUEST_SESSION_COOKIE = 'guest_session_token'
export const GUEST_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 Tage, wie beim Admin-Login

/**
 * Liest die aktuelle Gast-Session anhand des Cookie-Tokens aus der Datenbank. Strikt
 * getrenntes Cookie/Modell vom Admin-Login (siehe app/lib/auth.ts), damit Gast- und
 * Admin-Sessions nie verwechselt werden können.
 */
export async function getCurrentGuestUser(): Promise<GuestUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(GUEST_SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.guestSession.findUnique({ where: { token }, include: { guestUser: true } })
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
