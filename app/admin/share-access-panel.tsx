// app/admin/share-access-panel.tsx
import { shareResource, unshareResource } from './actions'
import ThemeSection, { themeClasses } from '../ui/theme-section'

type Share = { id: string; email: string }

/**
 * Zeigt/verwaltet die Moderator-Freigaben einer Ressource (Event ODER Reihe - genau
 * eine der beiden IDs wird übergeben). Wird ausschließlich auf Seiten gerendert, die
 * bereits selbst geprüft haben, dass der aktuelle Nutzer Owner oder Admin ist.
 */
export default function ShareAccessPanel({
  eventId,
  seriesId,
  shares,
  error
}: {
  eventId?: string
  seriesId?: string
  shares: Share[]
  error?: string
}) {
  const c = themeClasses('rose')

  return (
    <ThemeSection
      color="rose"
      title="Zugriff teilen (Moderator-Rechte)"
      description={`Gibt einem bestehenden Konto Zugriff auf Check-in sowie das Einsehen & Bearbeiten der Gäste- und Warteliste${seriesId ? ' für alle Termine dieser Reihe' : ''}. Das Konto muss bereits existieren (siehe "+ Nutzer anlegen").`}
    >
      {error === 'notfound' && (
        <div className="p-2 bg-red-50 text-red-700 text-xs rounded">
          Für diese E-Mail-Adresse existiert kein Konto.
        </div>
      )}

      {shares.length > 0 && (
        <ul className="space-y-1">
          {shares.map(share => (
            <li key={share.id} className={`flex justify-between items-center bg-white px-3 py-1.5 rounded border ${c.border} text-sm`}>
              <span className="text-gray-800">{share.email}</span>
              <form action={unshareResource}>
                <input type="hidden" name="accessId" value={share.id} />
                <button type="submit" className="text-red-600 hover:text-red-800 text-xs font-medium transition">
                  Entfernen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={shareResource} className="flex gap-2">
        {eventId && <input type="hidden" name="eventId" value={eventId} />}
        {seriesId && <input type="hidden" name="seriesId" value={seriesId} />}
        <input
          type="email"
          name="email"
          required
          placeholder="konto@domain.de"
          className={`flex-1 border ${c.border} p-2 rounded text-sm text-gray-900`}
        />
        <button type="submit" className="bg-rose-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-rose-700 transition">
          Teilen
        </button>
      </form>
    </ThemeSection>
  )
}
