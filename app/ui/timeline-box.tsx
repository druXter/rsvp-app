
/**
 * "Zeitplan" (Zeitplan-Tool, siehe app/api/timeline-link/[eventId]/route.ts): führt eine Zusage,
 * die zählt, zum Ablauf des Events. Nur dafür anzeigen; die Route prüft das trotzdem selbst noch
 * einmal. Ein normales <a>, kein <Link>: Ein Client-Router-Übergang in einen Route Handler, der
 * auf eine fremde Domain weiterleitet, hängt. Farbe fuchsia = Zeitplan (siehe CLAUDE.md "Farbschema").
 */
export default function TimelineBox({ eventId, editToken }: { eventId: string; editToken?: string | null }) {
  const href = `/api/timeline-link/${eventId}${editToken ? `?token=${encodeURIComponent(editToken)}` : ''}`
  return (
    <div className="w-full mt-4 p-4 rounded-lg border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900 dark:bg-fuchsia-950 dark:border-fuchsia-800 dark:text-fuchsia-100 text-center space-y-3">
      <p className="text-sm">Wann passiert was? Der Ablauf des Events, immer aktuell.</p>
      <a
        href={href}
        rel="noreferrer"
        className="inline-block bg-fuchsia-600 text-white font-bold py-2 px-6 rounded hover:bg-fuchsia-700 transition"
      >
        🕒 Zeitplan
      </a>
    </div>
  )
}
