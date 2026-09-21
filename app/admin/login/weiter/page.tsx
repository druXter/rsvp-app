// app/admin/login/weiter/page.tsx
import HardRedirect from './hard-redirect'

/**
 * Zwischenstation nach einem Login, der mit einem Föderations-Ablauf weitergehen soll (siehe
 * loginUser in app/admin/actions.ts). Erlaubt ausschließlich das Fortsetzen des Anbieter-Endpunkts
 * dieses Tools - jedes andere Ziel fällt auf das Dashboard zurück, damit diese Seite kein Weg für
 * Weiterleitungen an beliebige Adressen wird.
 */
export default async function WeiterPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams
  const target = to && to.startsWith('/api/suite/authorize?') && !to.startsWith('//') ? to : '/admin'

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-gray-900 dark:text-gray-100">
        <HardRedirect to={target} />
      </div>
    </main>
  )
}
