// app/mein-konto/account/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import { changeGuestPassword, requestGuestEmailChange, cancelGuestEmailChange } from '../actions'
import SubmitButton from '../../ui/submit-button'
import DeleteAccountButton from '../delete-account-button'

/**
 * Konto-Einstellungen für Nutzer-Konten (GuestUser) - Passwort ändern, E-Mail-Adresse
 * ändern und Konto löschen, ausgelagert von /mein-konto (das bewusst Reihen/Termine als
 * Hauptinhalt behält) hinter einem einzelnen "⚙️ Konto-Einstellungen"-Button. Spiegelt
 * app/admin/account/page.tsx für Admin-seitige Konten.
 */
export default async function GuestAccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string }>
}) {
  const guestUser = await getCurrentGuestUser()
  if (!guestUser) redirect('/mein-konto/login')

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
            <p className="text-sm text-gray-500">{guestUser.email}</p>
          </div>
          <Link href="/mein-konto" className="text-gray-500 hover:text-gray-800 transition text-sm">← Mein Konto</Link>
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

        {guestUser.pendingEmail && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-2">
            <p className="text-sm text-yellow-800">
              Ausstehende Änderung zu <strong>{guestUser.pendingEmail}</strong> - prüfe dein Postfach für den Bestätigungslink.
            </p>
            <form action={cancelGuestEmailChange}>
              <button type="submit" className="text-xs text-yellow-700 hover:text-yellow-900 underline">Änderung abbrechen</button>
            </form>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900">Passwort ändern</h2>
          <form action={changeGuestPassword} className="space-y-3">
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
          <form action={requestGuestEmailChange} className="space-y-3">
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

        <div className="bg-white p-6 rounded-lg shadow border-t-4 border-red-200 space-y-2">
          <h2 className="font-bold text-gray-900">Konto löschen</h2>
          <p className="text-xs text-gray-500">
            Löscht dein Konto, alle Reihen-Zuordnungen und alle deine Antworten zu jedem Termin jeder Reihe
            unwiderruflich. Mehr dazu in unserer <Link href="/datenschutz" className="underline">Datenschutzerklärung</Link>.
          </p>
          <DeleteAccountButton />
        </div>

      </div>
    </main>
  )
}
