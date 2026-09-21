// app/admin/reset-password/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { resetPassword } from '../actions'
import SubmitButton from '../../ui/submit-button'
import AuthError from '../../ui/auth-error'
import { hashToken } from '../../lib/tokens'

const prisma = new PrismaClient()

/**
 * Formular zum Setzen eines neuen Passworts über einen per Mail verschickten Reset-Link.
 * Prüft den Token schon beim Laden der Seite (nicht erst beim Absenden) - das verrät
 * niemandem etwas Neues, da nur der tatsächliche Empfänger der Mail den Token kennt, gibt
 * ihm aber sofort Rückmeldung statt erst nach dem Ausfüllen des Formulars.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams

  const user = token ? await prisma.user.findUnique({ where: { resetToken: hashToken(token) } }) : null
  const isValid = !!user && !!user.resetTokenExpiresAt && user.resetTokenExpiresAt > new Date()

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
              <Link href="/admin/forgot-password" className="text-blue-600 hover:underline">Neuen Link anfordern</Link>
            </p>
          </>
        ) : (
          <>
          <AuthError code={error} />
          <form action={resetPassword} className="space-y-4">
            <input type="hidden" name="token" value={token} />

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neues Passwort</label>
              <input
                id="password"
                type="password"
                name="password"
                required
                minLength={10}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100"
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
