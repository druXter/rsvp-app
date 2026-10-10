// app/admin/share-access-panel.tsx
import { shareResource, unshareResource } from './actions'
import ThemeSection, { themeClasses } from '../ui/theme-section'
import { buttonClass, inputClass } from '../ui/kit'

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
        <div className="p-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs rounded">
          Für diese E-Mail-Adresse existiert kein Konto.
        </div>
      )}

      {shares.length > 0 && (
        <ul className="space-y-1">
          {shares.map(share => (
            <li key={share.id} className={`flex justify-between items-center bg-white dark:bg-gray-800 px-3 py-1.5 rounded border ${c.border} text-sm`}>
              <span className="text-gray-800 dark:text-gray-100">{share.email}</span>
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
          className={inputClass}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Teilen
        </button>
      </form>
    </ThemeSection>
  )
}
