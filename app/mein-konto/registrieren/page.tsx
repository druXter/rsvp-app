// app/mein-konto/registrieren/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { registerGuestUser } from '../actions'
import { getCurrentGuestUser } from '../../lib/guest-auth'
import AuthError from '../../ui/auth-error'
import { ProofOfWork, SubmitButton, inputClass, linkClass } from '../../ui/kit'

/**
 * Allgemeine Registrierung eines Teilnehmendenkontos - ohne Reihe oder Event (registerGuestUser ohne seriesId/eventId).
 * Das Konto sieht danach unter "Mein Konto" die Termine, zu denen es eingeladen wird oder auf die es antwortet, und
 * kann Reihen beitreten. Gleiche Regeln wie die Registrierung über eine Reihe: Bestätigung per Mail, Drosselung,
 * Bot-Schutz. Wer schon angemeldet ist, landet direkt in "Mein Konto".
 */
export default async function GuestRegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (await getCurrentGuestUser()) redirect('/mein-konto')
  const { error, next } = await searchParams
  const loginHref = `/mein-konto/login${next ? `?next=${encodeURIComponent(next)}` : ''}`

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-10 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Konto anlegen</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Mit einem Teilnehmendenkonto siehst du unter „Mein Konto“ deine Termine und Reihen, antwortest ohne Links und
            musst Angaben wie Essenswunsch oder Allergien nur einmal eintragen. Veranstalter:innen können dich damit auch
            direkt zu Terminen einladen.
          </p>
        </div>

        {error === 'exists' && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded dark:bg-red-950 dark:text-red-300">
            Für diese E-Mail-Adresse existiert bereits ein Konto. <Link href={loginHref} className="underline font-medium">Hier einloggen</Link>.
          </div>
        )}

        <AuthError code={error} />
        <form action={registerGuestUser} className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Name</label>
            <input id="name" type="text" name="name" required maxLength={200} autoComplete="name" className={inputClass} placeholder="Max Mustermann" />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
            <input id="email" type="email" name="email" required maxLength={254} autoComplete="email" className={inputClass} placeholder="max@beispiel.de" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input id="password" type="password" name="password" required minLength={10} autoComplete="new-password" className={inputClass} placeholder="Mindestens 10 Zeichen" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Wir schicken dir einen Link zur Bestätigung. Was wir speichern, steht in der <Link href="/datenschutz" className="underline">Datenschutzerklärung</Link>.
          </p>
          <ProofOfWork />
          <SubmitButton>Konto erstellen</SubmitButton>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Bereits ein Konto? <Link href={loginHref} className={linkClass}>Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
