// app/mein-konto/login/page.tsx
import Link from 'next/link'
import { loginGuestUser } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Login-Seite für Gast-Konten ("Nutzer", siehe #12) - strikt getrennt vom Admin-Login
 * unter /admin/login (eigenes Cookie/Session-Modell, siehe app/lib/guest-auth.ts).
 */
export default async function GuestLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; registered?: string; reset?: string }> }) {
  const params = await searchParams
  const hasError = params.error === '1'
  const unverified = params.error === 'unverified'
  const justRegistered = params.registered === '1'
  const wasReset = params.reset === '1'

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900">Mein Konto</h1>

        {justRegistered && (
          <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded">
            Fast geschafft! Bitte bestätige dein Konto über den Link in der E-Mail, die wir dir gerade geschickt haben.
          </div>
        )}
        {wasReset && (
          <div className="p-3 bg-green-50 text-green-700 text-sm rounded">
            Dein Passwort wurde erfolgreich zurückgesetzt. Du kannst dich jetzt einloggen.
          </div>
        )}
        {unverified && (
          <div className="p-3 bg-yellow-50 text-yellow-700 text-sm rounded">
            Bitte bestätige zuerst dein Konto über den Link in deiner Bestätigungs-E-Mail.
          </div>
        )}
        {hasError && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
            E-Mail oder Passwort falsch. Bitte versuche es erneut.
          </div>
        )}

        <form action={loginGuestUser} className="space-y-4">
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

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Passwort</label>
            <input
              type="password"
              name="password"
              required
              className="w-full border border-gray-300 p-2 rounded text-gray-900"
              placeholder="Passwort eingeben"
            />
          </div>

          <SubmitButton>Einloggen</SubmitButton>
        </form>

        <p className="text-sm text-center text-gray-500">
          <Link href="/mein-konto/forgot-password" className="text-blue-600 hover:underline">Passwort vergessen?</Link>
        </p>
      </div>
    </main>
  )
}
