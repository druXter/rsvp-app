// app/mein-konto/account/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PrismaClient } from '@prisma/client'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import { cookies } from 'next/headers'
import { changeGuestPassword, requestGuestEmailChange, cancelGuestEmailChange, updateConfirmationEmailPreference, createApiToken, revokeApiToken } from '../actions'
import { NEW_API_TOKEN_COOKIE } from '../../lib/api-auth'
import SubmitButton from '../../ui/submit-button'
import DeleteAccountButton from '../delete-account-button'

const prisma = new PrismaClient()

/**
 * Konto-Einstellungen für Nutzer-Konten (GuestUser) - Passwort ändern, E-Mail-Adresse
 * ändern und Konto löschen, ausgelagert von /mein-konto (das bewusst Reihen/Termine als
 * Hauptinhalt behält) hinter einem einzelnen "⚙️ Konto-Einstellungen"-Button. Spiegelt
 * app/admin/account/page.tsx für Admin-seitige Konten.
 */
export default async function GuestAccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string; confirmationPrefSaved?: string; tokenCreated?: string; tokenRevoked?: string }>
}) {
  const guestUser = await getCurrentGuestUser()
  if (!guestUser) redirect('/mein-konto/login')

  const params = await searchParams
  const wrongPassword = params.error === 'wrongpassword'
  const emailTaken = params.error === 'emailtaken'
  const noPushSubscription = params.error === 'nopush'
  const passwordChanged = params.passwordChanged === '1'
  const emailChangeRequested = params.emailChangeRequested === '1'
  const confirmationPrefSaved = params.confirmationPrefSaved === '1'

  const hasPushSubscription = (await prisma.participantPushSubscription.count({
    where: { participant: { guestUserId: guestUser.id } }
  })) > 0

  const tokenCreated = params.tokenCreated === '1'
  const tokenRevoked = params.tokenRevoked === '1'
  const apiTokens = await prisma.guestApiToken.findMany({
    where: { guestUserId: guestUser.id },
    orderBy: { createdAt: 'desc' }
  })
  // Klartext des frisch erzeugten Tokens - steht nur die eine Minute im Cookie, die
  // createApiToken ihm gibt, und ist danach nirgends mehr abrufbar.
  const newToken = (await cookies()).get(NEW_API_TOKEN_COOKIE)?.value
  const baseUrl = process.env.BASE_URL || 'https://rsvp.ramonroeser.de'

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
        {noPushSubscription && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">Dafür brauchst du zuerst mindestens ein aktiviertes Push-Abo für eine deiner Reihen.</div>
        )}
        {confirmationPrefSaved && (
          <div className="p-3 bg-green-50 text-green-700 text-sm rounded">Einstellung gespeichert.</div>
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

        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <h2 className="font-bold text-gray-900">Bestätigungs-Mails</h2>
          <p className="text-sm text-gray-500">
            Wenn du Push-Benachrichtigungen für eine deiner Reihen aktiviert hast, siehst du eine Zusage
            auch direkt in dieser App. Du kannst dann auf die separate Bestätigungs-Mail verzichten.
          </p>
          <form action={updateConfirmationEmailPreference} className="space-y-2">
            <label className={`flex items-start gap-2 text-sm ${hasPushSubscription ? 'text-gray-700' : 'text-gray-400'}`}>
              <input
                type="checkbox"
                name="disableConfirmationEmails"
                value="true"
                defaultChecked={guestUser.disableConfirmationEmails}
                disabled={!hasPushSubscription}
              />
              <span>Keine Bestätigungs-Mails mehr schicken, wenn ich per Push benachrichtigt werde</span>
            </label>
            {!hasPushSubscription && (
              <p className="text-xs text-gray-400">Aktiviere zuerst Push-Benachrichtigungen auf einer deiner Termin-Seiten.</p>
            )}
            <SubmitButton>Speichern</SubmitButton>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <h2 className="font-bold text-gray-900">API-Zugang für eigene Apps</h2>
          <p className="text-sm text-gray-500">
            Mit einem API-Token kann eine selbstgebaute App (z.B. für die Apple Watch) deine Termine abrufen
            und für dich zu- oder absagen. Ein Token gilt nur für dein Konto und deine eigenen Antworten -
            niemals für Gästelisten anderer Personen.
          </p>

          {tokenRevoked && (
            <p className="text-sm text-green-700 bg-green-50 p-2 rounded">Token widerrufen. Geräte, die ihn genutzt haben, kommen nicht mehr an deine Daten.</p>
          )}

          {newToken && tokenCreated && (
            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded space-y-2">
              <p className="text-sm text-yellow-800 font-medium">
                Dein neuer Token - kopiere ihn jetzt, er wird nie wieder angezeigt:
              </p>
              <code className="block bg-white border border-yellow-300 p-2 rounded text-xs break-all text-gray-900">{newToken}</code>
              <p className="text-xs text-yellow-700">
                Behandle ihn wie ein Passwort. Wenn er abhandenkommt, widerrufe ihn hier - dein Konto bleibt davon unberührt.
              </p>
            </div>
          )}

          {apiTokens.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
              {apiTokens.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 p-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{t.name}</p>
                    <p className="text-xs text-gray-500">
                      Erstellt am {t.createdAt.toLocaleDateString('de-DE')} ·{' '}
                      {t.lastUsedAt ? `zuletzt genutzt am ${t.lastUsedAt.toLocaleDateString('de-DE')}` : 'noch nie genutzt'}
                    </p>
                  </div>
                  <form action={revokeApiToken}>
                    <input type="hidden" name="tokenId" value={t.id} />
                    <button type="submit" className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 transition whitespace-nowrap">
                      Widerrufen
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={createApiToken} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Neuen Token erzeugen</label>
            <input
              type="text"
              name="name"
              required
              maxLength={60}
              placeholder="Wofür? z.B. Apple Watch"
              className="w-full border border-gray-300 p-2 rounded text-gray-900"
            />
            <SubmitButton>Token erzeugen</SubmitButton>
          </form>

          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer text-gray-700">So wird der Token benutzt</summary>
            <div className="mt-2 space-y-2">
              <p>
                Jede Anfrage schickt den Token im Header <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>.
                Basis-Adresse: <code className="text-xs break-all">{baseUrl}/api/v1</code>
              </p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><code>GET /me</code> - dein Profil, zum Prüfen ob der Token gültig ist</li>
                <li><code>GET /termine</code> - deine Reihen mit allen kommenden Terminen und deiner bisherigen Antwort</li>
                <li><code>POST /termine/&lt;terminId&gt;/antwort</code> - antworten, JSON-Body z.B. <code>{'{"isAttending": true}'}</code></li>
              </ul>
              <p className="text-xs">
                Beim Antworten sind optional <code>plusOne</code>, <code>plusOneName</code>, <code>bringingItem</code>,{' '}
                <code>drinksAlcohol</code>, <code>additionalInfo</code>, <code>declineReason</code> und{' '}
                <code>customAnswers</code> erlaubt. Name und Kontaktdaten kommen immer aus deinem Konto.
                Die Antwort enthält <code>isOnWaitlist</code> und - bei Terminen mit Einlasskontrolle -{' '}
                <code>checkinQrCode</code>.
              </p>
            </div>
          </details>
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
