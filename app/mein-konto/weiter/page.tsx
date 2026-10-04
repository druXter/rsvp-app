import HardRedirect from '../../admin/login/weiter/hard-redirect'

/**
 * Zwischenstation nach der Gast-Anmeldung bzw. der Zustimmung, wenn eine Anmeldung für ein anderes
 * Tool weitergehen soll (Teilnehmenden-Bestätigung, siehe app/api/suite/authorize/route.ts). Wie
 * /admin/login/weiter nur für den Anbieter-Endpunkt dieses Tools - alles andere führt zu "Mein Konto".
 */
export default async function GuestWeiterPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams
  const target = to && to.startsWith('/api/suite/authorize?') && !to.startsWith('//') ? to : '/mein-konto'

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-gray-900 dark:text-gray-100">
        <HardRedirect to={target} />
      </div>
    </main>
  )
}
