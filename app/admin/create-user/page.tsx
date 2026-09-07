// app/admin/create-user/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { createUser } from '../actions'

/**
 * Legt ein weiteres Benutzerkonto an (z.B. für ein anderes Referat oder einen
 * Freund). Es gibt keine öffentliche Registrierung - nur wer bereits eingeloggt
 * ist, kann hier neue Konten erstellen. Das neue Konto sieht ausschließlich seine
 * eigenen, künftig angelegten Events - nie die des einladenden Nutzers.
 */
export default async function CreateUserPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const params = await searchParams
  const alreadyExists = params.error === 'exists'

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
          Das neue Konto verwaltet ausschließlich seine eigenen Events - eure Gästelisten bleiben getrennt.
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

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Konto anlegen
          </button>
        </form>
      </div>
    </main>
  )
}
