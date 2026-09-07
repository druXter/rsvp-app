// app/admin/guest-members-panel.tsx
import { addGuestUserToSeries, removeGuestUserFromSeries } from './actions'
import ThemeSection, { themeClasses } from '../ui/theme-section'

type Member = { membershipId: string; email: string; name: string }

/**
 * Ordnet ein BESTEHENDES Nutzer-Konto (siehe #12, GuestUser) einer weiteren Reihe zu,
 * ohne dass dafür ein neues Konto nötig wäre. Nur auf der Reihen-Edit-Seite gerendert,
 * die bereits selbst geprüft hat, dass der aktuelle Nutzer Owner/Moderator/Admin ist.
 */
export default function GuestMembersPanel({
  seriesId,
  members,
  error
}: {
  seriesId: string
  members: Member[]
  error?: string
}) {
  const c = themeClasses('emerald')

  return (
    <ThemeSection
      color="emerald"
      title="Nutzer-Mitglieder dieser Reihe"
      description={'Bestehende Nutzer-Konten (per Selbstregistrierung auf der Reihen-Seite entstanden) können hier zusätzlich zu dieser Reihe hinzugefügt werden, ohne ein neues Konto anzulegen. Sie sehen die Termine dann automatisch in ihrem "Mein Konto"-Bereich.'}
    >
      {error === 'notfound' && (
        <div className="p-2 bg-red-50 text-red-700 text-xs rounded">Für diese E-Mail-Adresse existiert kein Nutzer-Konto.</div>
      )}

      {members.length > 0 && (
        <ul className="space-y-1">
          {members.map(m => (
            <li key={m.membershipId} className={`flex justify-between items-center bg-white px-3 py-1.5 rounded border ${c.border} text-sm`}>
              <span className="text-gray-800">{m.name} ({m.email})</span>
              <form action={removeGuestUserFromSeries}>
                <input type="hidden" name="membershipId" value={m.membershipId} />
                <button type="submit" className="text-red-600 hover:text-red-800 text-xs font-medium transition">
                  Entfernen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addGuestUserToSeries} className="flex gap-2">
        <input type="hidden" name="seriesId" value={seriesId} />
        <input
          type="email"
          name="email"
          required
          placeholder="nutzer@domain.de"
          className={`flex-1 border ${c.border} p-2 rounded text-sm text-gray-900`}
        />
        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-emerald-700 transition">
          Hinzufügen
        </button>
      </form>
    </ThemeSection>
  )
}
