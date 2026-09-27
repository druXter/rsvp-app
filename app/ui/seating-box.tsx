// app/ui/seating-box.tsx

/**
 * "Sitzplatz wählen" (Seating, siehe app/api/seating-link/[eventId]/route.ts) und - sobald Seating
 * einen Platz gemeldet hat - "Dein Platz: …". Nur für eine Zusage anzeigen, die bei Seating zählt;
 * die Route prüft das trotzdem selbst noch einmal. Ein normales <a>, kein <Link>: Ein
 * Client-Router-Übergang in einen Route Handler, der auf eine fremde Domain weiterleitet, hängt.
 * Farbe lime = Sitzplatz (siehe CLAUDE.md "Farbschema").
 */
export default function SeatingBox({ eventId, editToken, seatingLabel }: { eventId: string; editToken?: string | null; seatingLabel?: string | null }) {
  const href = `/api/seating-link/${eventId}${editToken ? `?token=${encodeURIComponent(editToken)}` : ''}`
  return (
    <div className="w-full mt-4 p-4 rounded-lg border border-lime-300 bg-lime-50 text-lime-900 dark:bg-lime-950 dark:border-lime-800 dark:text-lime-100 text-center space-y-3">
      {seatingLabel && (
        <p className="text-lg">
          🪑 Dein Platz: <strong>{seatingLabel}</strong>
        </p>
      )}
      <a
        href={href}
        className="inline-block bg-lime-600 text-white font-bold py-2 px-6 rounded hover:bg-lime-700 transition"
      >
        {seatingLabel ? 'Sitzplatz ansehen oder ändern' : '🪑 Sitzplatz wählen'}
      </a>
    </div>
  )
}
