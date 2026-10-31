// app/ui/info-page-box.tsx

/**
 * „Infos für Gäste“ (Idee L38, app/api/info-link/[eventId]/route.ts): führt eine Zusage, die zählt, auf die Seite mit
 * Gäste-Bereich in der Startseite (Adresse der Location, Hotel, WLAN …). Nur dafür anzeigen; die Route prüft das
 * trotzdem selbst. Ein normales <a>, kein <Link> (Weiterleitung auf eine fremde Domain).
 */
export default function InfoPageBox({ eventId, editToken, className = '' }: { eventId: string; editToken?: string | null; className?: string }) {
  const href = `/api/info-link/${eventId}${editToken ? `?token=${encodeURIComponent(editToken)}` : ''}`
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800 ${className}`} data-testid="info-page-box">
      <p className="text-sm text-gray-700 dark:text-gray-300">Anfahrt, Unterkunft und alles Weitere – nur für Gäste mit Zusage.</p>
      <a href={href} rel="noreferrer"
        className="mt-3 inline-block rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white transition hover:bg-blue-700">
        Infos für Gäste
      </a>
    </div>
  )
}
