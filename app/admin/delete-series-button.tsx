// app/admin/delete-series-button.tsx
'use client'

import { deleteEventSeries } from './actions'
import { buttonClass } from '../ui/kit'

/**
 * Button-Komponente zum Löschen einer kompletten Veranstaltungsreihe inkl. aller
 * Termine, Antworten und Gast-Profile. Beinhaltet eine Sicherheitsabfrage im Browser.
 */
export default function DeleteSeriesButton({ seriesId }: { seriesId: string }) {
  return (
    <form action={deleteEventSeries} onSubmit={(e) => {
      if (!window.confirm('Reihe wirklich löschen? Alle Termine, Antworten und Gast-Profile gehen unwiderruflich verloren!')) {
        e.preventDefault()
      }
    }}>
      <input type="hidden" name="seriesId" value={seriesId} />
      <button type="submit" className={buttonClass('danger')}>
        🗑️ Reihe löschen
      </button>
    </form>
  )
}
