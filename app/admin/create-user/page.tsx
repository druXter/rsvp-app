// app/admin/create-user/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { createUser } from '../actions'
import SubmitButton from '../../ui/submit-button'
import AuthError from '../../ui/auth-error'

/**
 * Legt ein weiteres Benutzerkonto an (z.B. für ein anderes Referat, einen Freund
 * oder einen Moderator). Es gibt keine öffentliche Registrierung - nur wer bereits
 * eingeloggt ist (außer Moderatoren), kann hier neue Konten erstellen. Nur Admins
 * dürfen dabei die Rolle Creator oder Admin vergeben; alle anderen können ausschließlich
 * Moderator-Konten anlegen (siehe createUser-Action für die serverseitige Durchsetzung).
 */
export default async function CreateUserPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role === 'MODERATOR') redirect('/admin')

  const params = await searchParams
  const alreadyExists = params.error === 'exists'
  const isAdmin = user.role === 'ADMIN'

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-md mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <div className="flex justify-between items-center border-b dark:border-gray-700 pb-4">
          <h1 className="text-2xl font-bold">Nutzer anlegen</h1>
          <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">
            Abbrechen
          </Link>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300">
          {isAdmin
            ? 'Lege ein eigenständiges Creator-Konto (z.B. für ein anderes Referat) oder ein Moderator-Konto an.'
            : 'Lege ein Moderator-Konto an, dem du anschließend Zugriff auf einzelne Events oder Reihen geben kannst.'}
        </p>

        {alreadyExists && (
          <div className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">
            Für diese E-Mail-Adresse existiert bereits ein Konto.
          </div>
        )}

        <AuthError code={params.error} />
        <form action={createUser} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
            <input id="email" type="email" name="email" required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" placeholder="referat@domain.de" />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input id="password" type="password" name="password" required minLength={10} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" placeholder="Mindestens 10 Zeichen" />
          </div>

          {isAdmin ? (
            <div>
              <label htmlFor="role" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Rolle</label>
              <select id="role" name="role" defaultValue="MODERATOR" className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">
                <option value="CREATOR">Creator (eigenständiges Konto mit eigenen Events/Reihen)</option>
                <option value="MODERATOR">Moderator (nur mit dir geteilter Zugriff)</option>
                <option value="ADMIN">Admin (voller Zugriff auf alles)</option>
              </select>
            </div>
          ) : (
            <input type="hidden" name="role" value="MODERATOR" />
          )}

          <SubmitButton>Konto anlegen</SubmitButton>
        </form>
      </div>
    </main>
  )
}
