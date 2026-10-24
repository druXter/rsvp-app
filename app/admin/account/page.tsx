// app/admin/account/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '../../lib/auth'
import { ROLE_LABELS } from '../../lib/permissions'
import { changePassword, requestEmailChange, cancelEmailChange, unlinkIdentity, linkGuestAccount, unlinkGuestAccount } from '../actions'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import { prisma } from '../../lib/prisma'
import { getIdps, idpLabel } from '../../lib/suite'
import AuthError from '../../ui/auth-error'
import AdminShell from '../admin-shell'
import { PageHeader, inputClass, SubmitButton } from '../../ui/kit'

// Meldungen von linkGuestAccount (../actions).
const GUEST_LINK_ERRORS: Record<string, string> = {
  'guestlink-failed': 'E-Mail-Adresse oder Passwort des Teilnehmendenkontos ist falsch.',
  'guestlink-unverified': 'Dieses Teilnehmendenkonto ist noch nicht bestätigt. Bitte zuerst den Link aus der Bestätigungs-Mail öffnen.',
  'guestlink-taken': 'Dieses Teilnehmendenkonto ist bereits mit einem anderen Verwaltungskonto verknüpft.',
  'guestlink-locked': 'Zu viele Versuche. Bitte warte etwa 15 Minuten und versuche es dann erneut.',
}

/**
 * Konto-Einstellungen für eingeloggte Admin-Konten (jeder Rolle inkl. Admin): Passwort
 * ändern und E-Mail-Adresse ändern, beides erfordert das aktuelle Passwort statt eines
 * Mail-Links - siehe changePassword/requestEmailChange in ../actions für die
 * Sicherheits-Begründung gegenüber der (für Admins ausgeschlossenen) Passwort-Reset-Mail.
 */
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string; linked?: string; unlinked?: string; guestLinked?: string; guestUnlinked?: string }>
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

  const guestLinked = params.guestLinked === '1'
  const guestUnlinked = params.guestUnlinked === '1'
  const guestLinkError = GUEST_LINK_ERRORS[params.error ?? '']
  const linkedGuest = user.linkedGuestUserId
    ? await prisma.guestUser.findUnique({ where: { id: user.linkedGuestUserId }, select: { email: true, isVerified: true } })
    : null
  // Ist in diesem Browser schon ein Teilnehmendenkonto angemeldet, ist dessen Adresse der naheliegende Vorschlag.
  const currentGuest = linkedGuest ? null : await getCurrentGuestUser()

  const identities = await prisma.externalIdentity.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
  const linkable = getIdps().filter(idp => !identities.some(i => i.issuer === idp.issuer))

  return (
    <AdminShell user={user} width="narrow">
      <div className="space-y-6">
        <PageHeader title="Konto-Einstellungen" subtitle={<>{user.email} ({ROLE_LABELS[user.role]})</>} back={{ href: '/admin', label: 'Alle Events' }} />

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
              <input id="currentPassword" type="password" name="currentPassword" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neues Passwort</label>
              <input id="newPassword" type="password" name="newPassword" required minLength={10} className={inputClass} placeholder="Mindestens 10 Zeichen" />
            </div>
            <SubmitButton>Passwort ändern</SubmitButton>
          </form>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">E-Mail-Adresse ändern</h2>
          <form action={requestEmailChange} className="space-y-3">
            <div>
              <label htmlFor="currentPasswordForEmail" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Aktuelles Passwort</label>
              <input id="currentPasswordForEmail" type="password" name="currentPassword" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="newEmail" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Neue E-Mail-Adresse</label>
              <input id="newEmail" type="email" name="newEmail" required className={inputClass} />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Wird erst nach Bestätigung über einen an diese Adresse geschickten Link wirksam.</p>
            </div>
            <SubmitButton>Bestätigungslink anfordern</SubmitButton>
          </form>
        </div>
          </>
        )}

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Teilnehmendenkonto verknüpfen</h2>
          {guestLinked && (
            <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">Teilnehmendenkonto verknüpft.</div>
          )}
          {guestUnlinked && (
            <div className="p-3 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm rounded">Verknüpfung gelöst.</div>
          )}
          {guestLinkError && (
            <div role="alert" className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">{guestLinkError}</div>
          )}
          {linkedGuest ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Verknüpft mit <strong>{linkedGuest.email}</strong>. Wenn du dich hier anmeldest, bist du auch unter „Mein Konto“
                angemeldet. Umgekehrt nicht: Eine Anmeldung unter „Mein Konto“ öffnet die Verwaltung nie.
              </p>
              <form action={unlinkGuestAccount}>
                <button type="submit" className="text-sm text-red-600 dark:text-red-400 hover:underline">Verknüpfung lösen</button>
              </form>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Nimmst du auch selbst an Reihen teil? Dann verknüpfe dein Teilnehmendenkonto: Eine Anmeldung hier meldet dich
                dort mit an. Beide Konten bleiben getrennt, und eine Anmeldung unter „Mein Konto“ öffnet die Verwaltung nie.
              </p>
              <form action={linkGuestAccount} className="space-y-3">
                <div>
                  <label htmlFor="guestEmail" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail des Teilnehmendenkontos</label>
                  <input id="guestEmail" type="email" name="guestEmail" required defaultValue={currentGuest?.email ?? ''} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="guestPassword" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort des Teilnehmendenkontos</label>
                  <input id="guestPassword" type="password" name="guestPassword" required className={inputClass} />
                </div>
                <SubmitButton>Verknüpfen</SubmitButton>
              </form>
            </>
          )}
        </div>

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
    </AdminShell>
  )
}
