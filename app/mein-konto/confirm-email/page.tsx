// app/mein-konto/confirm-email/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'

const prisma = new PrismaClient()

/**
 * Bestätigt eine per requestGuestEmailChange angeforderte E-Mail-Änderung per Klick auf
 * den an die NEUE Adresse verschickten Link - mutiert bewusst schon beim Aufruf per GET,
 * gleiches Muster wie app/admin/confirm-email/page.tsx.
 */
export default async function GuestConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  if (!token) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Fehler</h1>
          <p className="text-gray-700">Es wurde kein Bestätigungs-Token übergeben.</p>
        </div>
      </main>
    )
  }

  const guestUser = await prisma.guestUser.findUnique({ where: { emailChangeToken: token } })

  if (!guestUser || !guestUser.pendingEmail || !guestUser.emailChangeTokenExpiresAt || guestUser.emailChangeTokenExpiresAt < new Date()) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Ungültiger Link</h1>
          <p className="text-gray-700">Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</p>
        </div>
      </main>
    )
  }

  try {
    await prisma.guestUser.update({
      where: { id: guestUser.id },
      data: { email: guestUser.pendingEmail, pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null }
    })
  } catch {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Adresse bereits vergeben</h1>
          <p className="text-gray-700">Diese E-Mail-Adresse wurde inzwischen von einem anderen Konto verwendet. Bitte fordere eine Änderung zu einer anderen Adresse an.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
        <h1 className="text-2xl font-bold text-green-600 mb-4">E-Mail-Adresse geändert! 🎉</h1>
        <p className="text-gray-700 mb-6">Deine neue E-Mail-Adresse ist jetzt <strong>{guestUser.pendingEmail}</strong>.</p>
        <Link href="/mein-konto/login" className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zum Login
        </Link>
      </div>
    </main>
  )
}
