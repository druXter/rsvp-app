// app/admin/confirm-email/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'

const prisma = new PrismaClient()

/**
 * Bestätigt eine per requestEmailChange angeforderte E-Mail-Änderung per Klick auf den
 * an die NEUE Adresse verschickten Link - mutiert bewusst schon beim Aufruf per GET
 * (gleiches Muster wie /verify, /mein-konto/verify und der QR-Checkin), damit ein Klick
 * reicht.
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
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

  const user = await prisma.user.findUnique({ where: { emailChangeToken: token } })

  if (!user || !user.pendingEmail || !user.emailChangeTokenExpiresAt || user.emailChangeTokenExpiresAt < new Date()) {
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
    await prisma.user.update({
      where: { id: user.id },
      data: { email: user.pendingEmail, pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null }
    })
  } catch {
    // Race Condition: Die Wunsch-Adresse wurde inzwischen von einem anderen Konto belegt
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
        <p className="text-gray-700 mb-6">Deine neue E-Mail-Adresse ist jetzt <strong>{user.pendingEmail}</strong>.</p>
        <Link href="/admin/login" className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zum Login
        </Link>
      </div>
    </main>
  )
}
