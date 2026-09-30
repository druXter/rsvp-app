// app/ui/status-card.tsx

/**
 * Zentrierte Karte für die Seiten hinter Mail-Links (Bestätigen, E-Mail-Änderung) - Titel in
 * Rot (Fehler), Grün (erledigt) oder neutral (noch zu bestätigen), darunter beliebiger Inhalt.
 */
export default function StatusCard({ title, tone, children }: { title: string; tone: 'error' | 'success' | 'neutral'; children: React.ReactNode }) {
  const color = tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'
  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow max-w-md w-full text-center text-gray-700 dark:text-gray-300">
        <h1 className={`text-2xl font-bold mb-4 ${color}`}>{title}</h1>
        {children}
      </div>
    </main>
  )
}
