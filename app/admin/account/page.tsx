// app/admin/account/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { ROLE_LABELS } from '../../lib/permissions'
import { changePassword, requestEmailChange, cancelEmailChange, unlinkIdentity } from '../actions'
import { prisma } from '../../lib/prisma'
import { getIdps, idpLabel } from '../../lib/suite'
import SubmitButton from '../../ui/submit-button'
import AuthError from '../../ui/auth-error'

/**
 * Konto-Einstellungen für eingeloggte Admin-Konten (jeder Rolle inkl. Admin): Passwort
 * ändern und E-Mail-Adresse ändern, beides erfordert das aktuelle Passwort statt eines
 * Mail-Links - siehe changePassword/requestEmailChange in ../actions für die
 * Sicherheits-Begründung gegenüber der (für Admins ausgeschlossenen) Passwort-Reset-Mail.
 */
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string; linked?: string; unlinked?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const params = await searchParams
  const wrongPassword = params.error === 'wrongpassword'
  const emailTaken = params.error === 'emailtaken'
  const passwordChanged = params.passwordChanged === '1'
  const emailChangeRequested = params.emailChangeRequested === '1'
  const linked = params.linked === '1'
  const unlinked = params.unlinked === '1'

  const identities = await prisma.externalIdentity.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
  const linkable = getIdps().filter(idp => !identities.some(i => i.issuer === idp.issuer))

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-md mx-auto space-y-6">

        <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Konto-Einstellungen</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user.email} <span className="text-gray-400 dark:text-gray-500">({ROLE_LABELS[user.role]})</span></p>
          </div>
          <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition text-sm">← Dashboard</Link>
        </div>

        {passwordChanged && (
          <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">Passwort erfolgreich geändert. Andere angemeldete Geräte wurden abgemeldet.</div>
        )}
        {wrongPassword && (
          <div className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">Aktuelles Passwort ist falsch.</div>
        )}
        {emailTaken && (
          <div className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">Für diese E-Mail-Adresse existiert bereits ein Konto.</div>
        )}
        {emailChangeRequested && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm rounded">Bestätigungslink an die neue Adresse gesendet. Die Änderung wird erst nach dem Klick darauf wirksam.</div>
        )}

        <AuthError code={params.error} />
        {linked && (
          <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">Konto verknüpft.</div>
        )}
        {unlinked && (
          <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">Verknüpfung entfernt.</div>
        )}

        {user.pendingEmail && (
          <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-4 rounded-lg space-y-2">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              Ausstehende Änderung zu <strong>{user.pendingEmail}</strong> - prüfe dein Postfach für den Bestätigungslink.
            </p>
            <form action={cancelEmailChange}>
              <button type="submit" className="text-xs text-yellow-700 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-200 underline">Änderung abbrechen</button>
            </form>
          </div>
        )}

        {user.passwordHash && (
          <>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Passwort ändern</h2>
          <form action={changePassword} className="space-y-3">
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Aktuelles Passwort</label>
              <input id="currentPassword" type="password" name="currentPassword" required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neues Passwort</label>
              <input id="newPassword" type="password" name="newPassword" required minLength={10} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" placeholder="Mindestens 10 Zeichen" />
            </div>
            <SubmitButton>Passwort ändern</SubmitButton>
          </form>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">E-Mail-Adresse ändern</h2>
          <form action={requestEmailChange} className="space-y-3">
            <div>
              <label htmlFor="currentPasswordForEmail" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Aktuelles Passwort</label>
              <input id="currentPasswordForEmail" type="password" name="currentPassword" required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor="newEmail" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neue E-Mail-Adresse</label>
              <input id="newEmail" type="email" name="newEmail" required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Wird erst nach Bestätigung über einen an diese Adresse geschickten Link wirksam.</p>
            </div>
            <SubmitButton>Bestätigungslink anfordern</SubmitButton>
          </form>
        </div>
          </>
        )}

        {(identities.length > 0 || linkable.length > 0) && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Verknüpfte Konten anderer Tools</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Damit meldest du dich hier ohne separates Passwort an. Dein Passwort dort erfährt dieses Tool nie.
            </p>

            {identities.map(identity => (
              <div key={identity.id} className="flex items-center justify-between gap-2 text-sm border dark:border-gray-700 rounded p-2 text-gray-800 dark:text-gray-200">
                <span>{new URL(identity.issuer).host}</span>
                <form action={unlinkIdentity}>
                  <input type="hidden" name="identityId" value={identity.id} />
                  <button type="submit" className="text-red-600 dark:text-red-400 hover:underline">Entfernen</button>
                </form>
              </div>
            ))}

            {linkable.map(idp => (
              // Bewusst <a> statt <Link>: ein Route Handler, der nicht vorab geladen werden soll.
              <a
                key={idp.issuer}
                href={`/api/suite/login?mode=link&idp=${encodeURIComponent(idp.issuer)}&next=${encodeURIComponent('/admin/account')}`}
                className="block text-center border border-gray-300 dark:border-gray-600 rounded py-2 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Mit {idpLabel(idp)} verknüpfen
              </a>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
