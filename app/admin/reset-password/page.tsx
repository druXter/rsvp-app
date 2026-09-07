// app/admin/reset-password/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { resetPassword } from '../actions'
import SubmitButton from '../../ui/submit-button'

const prisma = new PrismaClient()

/**
 * Formular zum Setzen eines neuen Passworts über einen per Mail verschickten Reset-Link.
 * Prüft den Token schon beim Laden der Seite (nicht erst beim Absenden) - das verrät
 * niemandem etwas Neues, da nur der tatsächliche Empfänger der Mail den Token kennt, gibt
 * ihm aber sofort Rückmeldung statt erst nach dem Ausfüllen des Formulars.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams

  const user = token ? await prisma.user.findUnique({ where: { resetToken: token } }) : null
  const isValid = !!user && !!user.resetTokenExpiresAt && user.resetTokenExpiresAt > new Date()

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
              <Link href="/admin/forgot-password" className="text-blue-600 hover:underline">Neuen Link anfordern</Link>
            </p>
          </>
        ) : (
          <form action={resetPassword} className="space-y-4">
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
