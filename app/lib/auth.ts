// app/lib/auth.ts
import { PrismaClient, User } from '@prisma/client'
import { cookies } from 'next/headers'

const prisma = new PrismaClient()

export const SESSION_COOKIE = 'session_token'
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 Tage

/**
 * Liest die aktuelle Session anhand des Cookie-Tokens aus der Datenbank.
 * Das Cookie selbst enthält nur den opaken Token - wer eingeloggt ist, ergibt
 * sich ausschließlich aus diesem Server-seitigen Lookup.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } })
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
