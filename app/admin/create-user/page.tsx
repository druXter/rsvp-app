// app/admin/create-user/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { createUser } from '../actions'
import SubmitButton from '../../ui/submit-button'

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
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-md mx-auto bg-white p-8 rounded-lg shadow space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Nutzer anlegen</h1>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <p className="text-sm text-gray-600">
          {isAdmin
            ? 'Lege ein eigenständiges Creator-Konto (z.B. für ein anderes Referat) oder ein Moderator-Konto an.'
            : 'Lege ein Moderator-Konto an, dem du anschließend Zugriff auf einzelne Events oder Reihen geben kannst.'}
        </p>

        {alreadyExists && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
            Für diese E-Mail-Adresse existiert bereits ein Konto.
          </div>
        )}

        <form action={createUser} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">E-Mail</label>
            <input type="email" name="email" required className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="referat@domain.de" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Passwort</label>
            <input type="password" name="password" required minLength={8} className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="Mindestens 8 Zeichen" />
          </div>

          {isAdmin ? (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Rolle</label>
              <select name="role" defaultValue="MODERATOR" className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white">
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
