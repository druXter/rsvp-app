// app/mein-konto/login/page.tsx
import Link from 'next/link'
import { loginGuestUser } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Login-Seite für Gast-Konten ("Nutzer", siehe #12) - strikt getrennt vom Admin-Login
 * unter /admin/login (eigenes Cookie/Session-Modell, siehe app/lib/guest-auth.ts).
 */
export default async function GuestLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; registered?: string; reset?: string; next?: string }> }) {
  const params = await searchParams
  const hasError = params.error === '1'
  const unverified = params.error === 'unverified'
  const justRegistered = params.registered === '1'
  const wasReset = params.reset === '1'
  const next = params.next || ''

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100">Mein Konto</h1>

        {justRegistered && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm rounded">
            Fast geschafft! Bitte bestätige dein Konto über den Link in der E-Mail, die wir dir gerade geschickt haben.
          </div>
        )}
        {wasReset && (
          <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">
            Dein Passwort wurde erfolgreich zurückgesetzt. Du kannst dich jetzt einloggen.
          </div>
        )}
        {unverified && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 text-sm rounded">
            Bitte bestätige zuerst dein Konto über den Link in deiner Bestätigungs-E-Mail.
          </div>
        )}
        {hasError && (
          <div className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">
            E-Mail oder Passwort falsch. Bitte versuche es erneut.
          </div>
        )}

        <form action={loginGuestUser} className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              placeholder="deine-email@domain.de"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input
              id="password"
              type="password"
              name="password"
              required
              className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              placeholder="Passwort eingeben"
            />
          </div>

          <SubmitButton>Einloggen</SubmitButton>
        </form>

        <p className="text-sm text-center text-gray-500 dark:text-gray-400">
          <Link href="/mein-konto/forgot-password" className="text-blue-600 hover:underline">Passwort vergessen?</Link>
        </p>

        <p className="text-xs text-center text-gray-400 dark:text-gray-500 border-t dark:border-gray-700 pt-4">
          Admin-Zugang für Events/Reihen? <Link href="/admin/login" className="text-blue-600 hover:underline">Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
