// app/mein-konto/verify/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'

const prisma = new PrismaClient()

/**
 * Bestätigt ein frisch registriertes Nutzer-Konto per Klick auf den Mail-Link - mutiert
 * bewusst schon beim Aufruf per GET (gleiches Muster wie app/verify/page.tsx und der
 * QR-Checkin), damit ein Klick reicht.
 */
export default async function GuestVerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
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

  const guestUser = await prisma.guestUser.findUnique({ where: { verifyToken: token } })

  if (!guestUser) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Ungültiger Link</h1>
          <p className="text-gray-700">Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.</p>
        </div>
      </main>
    )
  }

  await prisma.guestUser.update({
    where: { id: guestUser.id },
    data: { isVerified: true, verifiedAt: new Date(), verifyToken: null }
  })

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
        <h1 className="text-2xl font-bold text-green-600 mb-4">Konto bestätigt! 🎉</h1>
        <p className="text-gray-700 mb-6">Dein Konto ist jetzt aktiv. Du kannst dich ab sofort einloggen.</p>
        <Link href="/mein-konto/login" className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Jetzt einloggen
        </Link>
      </div>
    </main>
  )
}
