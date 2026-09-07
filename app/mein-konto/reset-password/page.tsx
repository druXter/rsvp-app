// app/mein-konto/reset-password/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { resetGuestPassword } from '../actions'
import SubmitButton from '../../ui/submit-button'

const prisma = new PrismaClient()

/**
 * Formular zum Setzen eines neuen Passworts für ein Nutzer-Konto über einen per Mail
 * verschickten Reset-Link. Prüft den Token schon beim Laden der Seite (siehe
 * app/admin/reset-password/page.tsx für dieselbe Begründung beim Admin-Pendant).
 */
export default async function GuestResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams

  const guestUser = token ? await prisma.guestUser.findUnique({ where: { resetToken: token } }) : null
  const isValid = !!guestUser && !!guestUser.resetTokenExpiresAt && guestUser.resetTokenExpiresAt > new Date()

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900">Neues Passwort vergeben</h1>

        {(error === 'invalid' || !isValid) ? (
          <>
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
              Dieser Link ist ungültig oder abgelaufen. Fordere gegebenenfalls einen neuen an.
            </div>
            <p className="text-sm text-center text-gray-500">
              <Link href="/mein-konto/forgot-password" className="text-blue-600 hover:underline">Neuen Link anfordern</Link>
            </p>
          </>
        ) : (
          <form action={resetGuestPassword} className="space-y-4">
            <input type="hidden" name="token" value={token} />

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Neues Passwort</label>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                className="w-full border border-gray-300 p-2 rounded text-gray-900"
                placeholder="Mindestens 8 Zeichen"
              />
            </div>

            <SubmitButton>Passwort speichern</SubmitButton>
          </form>
        )}
      </div>
    </main>
  )
}
