// app/admin/guest-members-panel.tsx
import { addGuestUserToSeries, removeGuestUserFromSeries } from './actions'

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
  return (
    <div className="space-y-3 pt-4 border-t border-gray-200 bg-blue-50 p-4 rounded-md">
      <h3 className="font-bold text-blue-900">Nutzer-Mitglieder dieser Reihe</h3>
      <p className="text-xs text-blue-700">
        Bestehende Nutzer-Konten (per Selbstregistrierung auf der Reihen-Seite entstanden) können hier zusätzlich zu
        dieser Reihe hinzugefügt werden, ohne ein neues Konto anzulegen. Sie sehen die Termine dann automatisch in
        ihrem &quot;Mein Konto&quot;-Bereich.
      </p>

      {error === 'notfound' && (
        <div className="p-2 bg-red-50 text-red-700 text-xs rounded">Für diese E-Mail-Adresse existiert kein Nutzer-Konto.</div>
      )}

      {members.length > 0 && (
        <ul className="space-y-1">
          {members.map(m => (
            <li key={m.membershipId} className="flex justify-between items-center bg-white px-3 py-1.5 rounded border border-blue-200 text-sm">
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
          className="flex-1 border border-blue-300 p-2 rounded text-sm text-gray-900"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition">
          Hinzufügen
        </button>
      </form>
    </div>
  )
}
