// app/admin/forgot-password/page.tsx
import Link from 'next/link'
import { requestPasswordReset } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Formular zum Anfordern eines Passwort-Reset-Links. Zeigt nach dem Absenden IMMER
 * dieselbe neutrale Bestätigung (siehe requestPasswordReset in ../actions) - egal ob die
 * E-Mail zu einem Konto gehört und egal ob es ein Admin-Konto ist (für die gibt es
 * bewusst keinen Self-Service-Reset, siehe #13).
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100">Passwort vergessen</h1>

        {sent === '1' ? (
          <>
            <div className="p-3 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm rounded">
              Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir dir eine E-Mail mit einem Link zum
              Zurücksetzen deines Passworts geschickt. Der Link ist eine Stunde gültig.
            </div>
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              <Link href="/admin/login" className="text-blue-600 hover:underline">Zurück zum Login</Link>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Gib deine E-Mail-Adresse ein - falls dazu ein Konto existiert, schicken wir dir einen Link zum
              Zurücksetzen deines Passworts.
            </p>

            <form action={requestPasswordReset} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  required
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100"
                  placeholder="deine-email@domain.de"
                />
              </div>

              <SubmitButton>Reset-Link anfordern</SubmitButton>
            </form>

            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              <Link href="/admin/login" className="text-blue-600 hover:underline">Zurück zum Login</Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
