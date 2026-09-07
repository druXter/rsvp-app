// app/mein-konto/actions.ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { PrismaClient } from '@prisma/client'
import { randomUUID, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { sendGuestVerificationEmail } from '../lib/mail'
import { requireGuestUser, GUEST_SESSION_COOKIE, GUEST_SESSION_DURATION_MS } from '../lib/guest-auth'

const prisma = new PrismaClient()

/**
 * Selbstregistrierung eines Gastes für eine bestimmte Reihe (Formular auf
 * /reihe/[seriesSlug]/registrieren, hinter derselben Reihen-PIN wie der Rest der Reihe).
 * Legt sofort die Mitgliedschaft für diese Reihe an; weitere Reihen kommen entweder über
 * addGuestUserToSeries (Creator/Moderator) oder automatisch beim ersten Beantworten eines
 * Termins einer anderen Reihe über die Gast-Session hinzu (siehe submitRsvp).
 */
export async function registerGuestUser(formData: FormData) {
  const seriesId = formData.get('seriesId') as string
  const name = (formData.get('name') as string || '').trim()
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formData.get('password') as string

  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
  if (!series) return

  const existing = await prisma.guestUser.findUnique({ where: { email } })
  if (existing) {
    redirect(`/reihe/${series.slug}/registrieren?error=exists`)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const verifyToken = randomUUID()
  const guestUser = await prisma.guestUser.create({
    data: { email, passwordHash, name, verifyToken, isVerified: false }
  })
  await prisma.guestUserSeries.create({ data: { guestUserId: guestUser.id, seriesId } })

  try {
    await sendGuestVerificationEmail(guestUser, series)
  } catch (error) {
    console.error('Fehler beim Senden der Nutzer-Verifizierungs-Mail:', error)
  }

  redirect('/mein-konto/login?registered=1')
}

/**
 * Prüft E-Mail/Passwort und erstellt bei Erfolg eine Gast-Session. Ein unverifiziertes
 * Konto (Klick auf den Bestätigungslink steht noch aus) darf sich bewusst noch nicht
 * einloggen, damit E-Mail-Adressen vor dem ersten Login als real bestätigt gelten.
 */
export async function loginGuestUser(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formData.get('password') as string

  const guestUser = await prisma.guestUser.findUnique({ where: { email } })
  const passwordMatches = guestUser ? await bcrypt.compare(password, guestUser.passwordHash) : false

  if (!guestUser || !passwordMatches) {
    redirect('/mein-konto/login?error=1')
  }
  if (!guestUser.isVerified) {
    redirect('/mein-konto/login?error=unverified')
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + GUEST_SESSION_DURATION_MS)
  await prisma.guestSession.create({ data: { token, guestUserId: guestUser.id, expiresAt } })

  const cookieStore = await cookies()
  cookieStore.set(GUEST_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: GUEST_SESSION_DURATION_MS / 1000,
    path: '/',
  })
  redirect('/mein-konto')
}

export async function logoutGuestUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(GUEST_SESSION_COOKIE)?.value
  if (token) {
    await prisma.guestSession.delete({ where: { token } }).catch(() => {})
  }
  cookieStore.set(GUEST_SESSION_COOKIE, '', { maxAge: 0, path: '/' })
  redirect('/mein-konto/login')
}

/**
 * Aktualisiert das zentrale Profil und spiegelt die Änderung sofort auf alle
 * Participant-Zeilen dieses Nutzer-Kontos über alle Reihen hinweg zurück - das ist der
 * Kern von "einmal ändern, überall aktuell" (siehe Architekturentscheidung zu #12).
 */
export async function updateGuestProfile(formData: FormData) {
  const guestUser = await requireGuestUser()

  const name = (formData.get('name') as string || '').trim()
  const phone = (formData.get('phone') as string || '').trim() || null
  const dietaryOption = (formData.get('dietaryOption') as string || '') || null
  const allergies = (formData.get('allergies') as string || '').trim() || null

  if (!name) return

  await prisma.guestUser.update({ where: { id: guestUser.id }, data: { name, phone, dietaryOption, allergies } })
  await prisma.participant.updateMany({ where: { guestUserId: guestUser.id }, data: { name, phone, dietaryOption, allergies } })

  revalidatePath('/mein-konto')
}
