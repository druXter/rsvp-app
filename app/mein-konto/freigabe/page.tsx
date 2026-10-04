import Link from 'next/link'
import { redirect } from 'next/navigation'
import { parseAuthorizeRequest } from 'suite-kit'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import { getParticipantApps, selfOrigin } from '../../lib/suite'
import { grantToolConsent } from '../actions'
import SubmitButton from '../../ui/submit-button'

const ERRORS: Record<string, string> = {
  app: 'Dieses Tool darf keine Anmeldung mit deinem Teilnehmendenkonto anfordern, oder der Link ist unvollständig.',
  unverified: 'Bitte bestätige zuerst dein Konto über den Link in deiner Bestätigungs-E-Mail.'
}

/**
 * Zustimmungsseite: Ein anderes Tool der Suite möchte, dass sich die Person dort mit ihrem
 * Teilnehmendenkonto anmeldet (suite-kit, Teilnehmenden-Bestätigung). Erscheint beim ersten Mal pro
 * Tool und nach einem Entzug; sagt genau, was übertragen wird. Ablehnen heißt einfach: nicht weiter.
 */
export default async function FreigabePage({ searchParams }: { searchParams: Promise<{ app?: string; state?: string; error?: string }> }) {
  const { app = '', state = '', error } = await searchParams
  const message = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null

  const origin = selfOrigin()
  const url = origin ? new URL('/api/suite/authorize', origin) : null
  if (url) url.search = new URLSearchParams({ app, state, kind: 'participant' }).toString()
  const parsed = url && !message ? parseAuthorizeRequest(url, [], getParticipantApps()) : null

  const guest = await getCurrentGuestUser()
  if (parsed?.ok && !guest) redirect(`/mein-konto/login?next=${encodeURIComponent(url!.pathname + url!.search)}`)

  const host = parsed?.ok ? new URL(parsed.request.app).host : null

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-4 text-gray-900 dark:text-gray-100">
        <h1 className="text-2xl font-bold">Anmelden in einem anderen Tool</h1>
        {!parsed?.ok || !guest || !host ? (
          <>
            <div role="alert" className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">
              {message ?? ERRORS.app}
            </div>
            <Link href="/mein-konto" className="text-sm text-blue-600 hover:underline">Zu Mein Konto</Link>
          </>
        ) : (
          <>
            <p>
              <strong>{host}</strong> möchte dich mit deinem Teilnehmendenkonto anmelden.
            </p>
            <div className="text-sm space-y-2">
              <p className="font-medium">Übertragen werden nur:</p>
              <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
                <li>dein Name: <strong>{guest.name}</strong></li>
                <li>eine Kennung, die nur für dieses Tool gilt (kein Rückschluss auf andere Tools)</li>
              </ul>
              <p className="text-gray-600 dark:text-gray-400">
                <strong>Nicht</strong> übertragen werden deine E-Mail-Adresse, Telefonnummer, Essenswünsche und Antworten.
                Dort bekommst du kein Verwaltungskonto, nur die Anmeldung als Teilnehmer:in.
              </p>
              <p className="text-gray-600 dark:text-gray-400">
                Wir merken uns deine Zustimmung, damit du nicht jedes Mal gefragt wirst. Entziehen kannst du sie
                jederzeit unter &quot;⚙️ Konto-Einstellungen&quot;.
              </p>
            </div>
            <form action={grantToolConsent} className="space-y-2">
              <input type="hidden" name="app" value={parsed.request.app} />
              <input type="hidden" name="state" value={parsed.request.state} />
              <SubmitButton>Erlauben und weiter</SubmitButton>
            </form>
            <Link href="/mein-konto" className="block text-center text-sm text-gray-600 dark:text-gray-400 hover:underline">Abbrechen</Link>
          </>
        )}
      </div>
    </main>
  )
}
