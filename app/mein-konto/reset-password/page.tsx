// app/mein-konto/reset-password/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { resetGuestPassword } from '../actions'
import SubmitButton from '../../ui/submit-button'
import AuthError from '../../ui/auth-error'
import { hashToken } from '../../lib/tokens'

const prisma = new PrismaClient()

/**
 * Formular zum Setzen eines neuen Passworts für ein Nutzer-Konto über einen per Mail
 * verschickten Reset-Link. Prüft den Token schon beim Laden der Seite (siehe
 * app/admin/reset-password/page.tsx für dieselbe Begründung beim Admin-Pendant).
 */
export default async function GuestResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams

  const guestUser = token ? await prisma.guestUser.findUnique({ where: { resetToken: hashToken(token) } }) : null
  const isValid = !!guestUser && !!guestUser.resetTokenExpiresAt && guestUser.resetTokenExpiresAt > new Date()

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100">Neues Passwort vergeben</h1>

        {(error === 'invalid' || !isValid) ? (
          <>
            <div className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">
              Dieser Link ist ungültig oder abgelaufen. Fordere gegebenenfalls einen neuen an.
            </div>
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              <Link href="/mein-konto/forgot-password" className="text-blue-600 hover:underline">Neuen Link anfordern</Link>
            </p>
          </>
        ) : (
          <>
          <AuthError code={error} />
          <form action={resetGuestPassword} className="space-y-4">
            <input type="hidden" name="token" value={token} />

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neues Passwort</label>
              <input
                id="password"
                type="password"
                name="password"
                required
                minLength={10}
                className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                placeholder="Mindestens 10 Zeichen"
              />
            </div>

            <SubmitButton>Passwort speichern</SubmitButton>
          </form>
          </>
        )}
      </div>
    </main>
  )
}
