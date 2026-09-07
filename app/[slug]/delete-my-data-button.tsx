// app/[slug]/delete-my-data-button.tsx
'use client'

import { deleteMyParticipantData } from '../actions'

/**
 * Self-Service-Löschung der eigenen Gast-Identität (Recht auf Löschung, Art. 17 DSGVO).
 * Bei einer Reihe warnt der Bestätigungsdialog ausdrücklich, dass dies ALLE eigenen
 * Antworten der Reihe betrifft, nicht nur den aktuell angezeigten Termin - der Participant
 * dahinter ist über die ganze Reihe hinweg geteilt (siehe app/actions.ts submitRsvp).
 */
export default function DeleteMyDataButton({
  editToken,
  eventId,
  isSeriesShared = false
}: {
  editToken: string
  eventId: string
  isSeriesShared?: boolean
}) {
  const warning = isSeriesShared
    ? 'Wirklich alle deine Daten unwiderruflich löschen? Das entfernt deinen Namen, deine Kontaktdaten und ALLE deine Antworten zu JEDEM Termin dieser Reihe - nicht nur zu diesem einen Termin. Dieser Link funktioniert danach nicht mehr.'
    : 'Wirklich alle deine Daten zu diesem Event unwiderruflich löschen? Das entfernt deinen Namen, deine Kontaktdaten und deine Antwort. Dieser Link funktioniert danach nicht mehr.'

  return (
    <form
      action={deleteMyParticipantData}
      onSubmit={(e) => {
        if (!window.confirm(warning)) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="editToken" value={editToken} />
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" className="text-xs text-red-600 hover:text-red-800 hover:underline transition">
        🗑️ Meine Daten vollständig löschen
      </button>
    </form>
  )
}
