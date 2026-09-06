// app/admin/delete-series-button.tsx
'use client'

import { deleteEventSeries } from './actions'

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
      <button type="submit" className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded hover:bg-red-200 transition">
        🗑️ Reihe löschen
      </button>
    </form>
  )
}
