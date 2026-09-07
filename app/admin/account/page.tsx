// app/admin/account/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { ROLE_LABELS } from '../../lib/permissions'
import { changePassword, requestEmailChange, cancelEmailChange } from '../actions'
import SubmitButton from '../../ui/submit-button'

/**
 * Konto-Einstellungen für eingeloggte Admin-Konten (jeder Rolle inkl. Admin): Passwort
 * ändern und E-Mail-Adresse ändern, beides erfordert das aktuelle Passwort statt eines
 * Mail-Links - siehe changePassword/requestEmailChange in ../actions für die
 * Sicherheits-Begründung gegenüber der (für Admins ausgeschlossenen) Passwort-Reset-Mail.
 */
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const params = await searchParams
  const wrongPassword = params.error === 'wrongpassword'
  const emailTaken = params.error === 'emailtaken'
  const passwordChanged = params.passwordChanged === '1'
  const emailChangeRequested = params.emailChangeRequested === '1'

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-md mx-auto space-y-6">

        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Konto-Einstellungen</h1>
            <p className="text-sm text-gray-500">{user.email} <span className="text-gray-400">({ROLE_LABELS[user.role]})</span></p>
          </div>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition text-sm">← Dashboard</Link>
        </div>

        {passwordChanged && (
          <div className="p-3 bg-green-50 text-green-700 text-sm rounded">Passwort erfolgreich geändert. Andere angemeldete Geräte wurden abgemeldet.</div>
        )}
        {wrongPassword && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">Aktuelles Passwort ist falsch.</div>
        )}
        {emailTaken && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">Für diese E-Mail-Adresse existiert bereits ein Konto.</div>
        )}
        {emailChangeRequested && (
          <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded">Bestätigungslink an die neue Adresse gesendet. Die Änderung wird erst nach dem Klick darauf wirksam.</div>
        )}

        {user.pendingEmail && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-2">
            <p className="text-sm text-yellow-800">
              Ausstehende Änderung zu <strong>{user.pendingEmail}</strong> - prüfe dein Postfach für den Bestätigungslink.
            </p>
            <form action={cancelEmailChange}>
              <button type="submit" className="text-xs text-yellow-700 hover:text-yellow-900 underline">Änderung abbrechen</button>
            </form>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900">Passwort ändern</h2>
          <form action={changePassword} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Aktuelles Passwort</label>
              <input type="password" name="currentPassword" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Neues Passwort</label>
              <input type="password" name="newPassword" required minLength={8} className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="Mindestens 8 Zeichen" />
            </div>
            <SubmitButton>Passwort ändern</SubmitButton>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900">E-Mail-Adresse ändern</h2>
          <form action={requestEmailChange} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Aktuelles Passwort</label>
              <input type="password" name="currentPassword" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Neue E-Mail-Adresse</label>
              <input type="email" name="newEmail" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
              <p className="text-xs text-gray-500 mt-1">Wird erst nach Bestätigung über einen an diese Adresse geschickten Link wirksam.</p>
            </div>
            <SubmitButton>Bestätigungslink anfordern</SubmitButton>
          </form>
        </div>

      </div>
    </main>
  )
}
