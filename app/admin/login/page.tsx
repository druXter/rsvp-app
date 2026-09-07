// app/admin/login/page.tsx
import { loginUser } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Login-Seite. Stellt ein Formular für E-Mail + Passwort bereit und fängt Fehler
 * über URL-Parameter ab.
 */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900">Login</h1>

        {hasError && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
            E-Mail oder Passwort falsch. Bitte versuche es erneut.
          </div>
        )}

        <form action={loginUser} className="space-y-4">
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
      </div>
    </main>
  )
}
