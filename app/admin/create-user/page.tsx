// app/admin/create-user/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '../../lib/auth'
import { createUser } from '../actions'
import SubmitButton from '../../ui/submit-button'
import AuthError from '../../ui/auth-error'
import AdminShell from '../admin-shell'
import { PageHeader, inputClass } from '../../ui/kit'

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
    <AdminShell user={user} width="narrow">
      <PageHeader title="Verwaltungskonto anlegen" back={{ href: '/admin', label: 'Zurück' }} />
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 space-y-6 text-gray-900 dark:text-gray-100">

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
            <input id="email" type="email" name="email" required className={inputClass} placeholder="referat@domain.de" />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input id="password" type="password" name="password" required minLength={10} className={inputClass} placeholder="Mindestens 10 Zeichen" />
          </div>

          {isAdmin ? (
            <div>
              <label htmlFor="role" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Rolle</label>
              <select id="role" name="role" defaultValue="MODERATOR" className={inputClass}>
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
    </AdminShell>
  )
}
