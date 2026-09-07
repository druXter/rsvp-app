// app/mein-konto/forgot-password/page.tsx
import Link from 'next/link'
import { requestGuestPasswordReset } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Formular zum Anfordern eines Passwort-Reset-Links für ein Nutzer-Konto. Zeigt nach dem
 * Absenden IMMER dieselbe neutrale Bestätigung (siehe requestGuestPasswordReset in
 * ../actions) - egal ob die E-Mail zu einem Konto gehört.
 */
export default async function GuestForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900">Passwort vergessen</h1>

        {sent === '1' ? (
          <>
            <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded">
              Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir dir eine E-Mail mit einem Link zum
              Zurücksetzen deines Passworts geschickt. Der Link ist eine Stunde gültig.
            </div>
            <p className="text-sm text-center text-gray-500">
              <Link href="/mein-konto/login" className="text-blue-600 hover:underline">Zurück zum Login</Link>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Gib deine E-Mail-Adresse ein - falls dazu ein Konto existiert, schicken wir dir einen Link zum
              Zurücksetzen deines Passworts.
            </p>

            <form action={requestGuestPasswordReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">E-Mail</label>
                <input
                  type="email"
                  name="email"
                  required
                  className="w-full border border-gray-300 p-2 rounded text-gray-900"
                  placeholder="deine-email@domain.de"
                />
              </div>

              <SubmitButton>Reset-Link anfordern</SubmitButton>
            </form>

            <p className="text-sm text-center text-gray-500">
              <Link href="/mein-konto/login" className="text-blue-600 hover:underline">Zurück zum Login</Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
