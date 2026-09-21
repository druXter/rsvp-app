// app/[slug]/guest-required-gate.tsx
import Link from 'next/link'

/**
 * Wird anstelle des RSVP-Formulars angezeigt, wenn requireGuestUser aktiv ist und weder ein
 * editToken noch eine eingeloggte Gast-Session vorliegt (siehe app/[slug]/page.tsx und
 * app/reihe/[seriesSlug]/[terminSlug]/page.tsx) - anonyme Anmeldungen sind dann bewusst
 * nicht möglich, "Einloggen"/"Konto erstellen" tragen den aktuellen Pfad als `next` mit, damit
 * der Gast nach dem Login/der Verifizierung direkt wieder hier landet statt auf dem
 * allgemeinen /mein-konto-Dashboard (das Einzel-Events ohnehin nicht auflistet).
 */
export default function GuestRequiredGate({
  title,
  loginHref,
  registerHref
}: {
  title: string
  loginHref: string
  registerHref: string
}) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md max-w-md w-full border border-gray-100 dark:border-gray-700 text-center space-y-4">
        <span className="text-4xl block">🔒</span>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{title}</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Für dieses Event ist ein Nutzer-Konto erforderlich. Bitte logge dich ein oder erstelle
          ein Konto, um teilzunehmen.
        </p>

        <div className="flex flex-col gap-3 pt-2">
          <Link href={loginHref} className="block bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Einloggen
          </Link>
          <Link href={registerHref} className="block bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold py-2 px-4 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            Konto erstellen
          </Link>
        </div>
      </div>
    </div>
  )
}
