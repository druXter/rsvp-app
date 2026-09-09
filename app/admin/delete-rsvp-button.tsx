// app/admin/delete-rsvp-button.tsx
'use client'

import { deleteRsvp } from './actions'

/**
 * Kompakter Button zum Löschen einer einzelnen Gast-Antwort (RSVP) aus der Dashboard-Tabelle.
 * Nutzt einen nativen Bestätigungsdialog zum Schutz vor versehentlichen Klicks.
 */
export default function DeleteRsvpButton({ rsvpId }: { rsvpId: string }) {
  return (
    <form action={deleteRsvp}>
      <input type="hidden" name="rsvpId" value={rsvpId} />
      <button 
        type="submit" 
        onClick={(e) => { 
          if (!confirm('Diese Antwort wirklich unwiderruflich löschen?')) e.preventDefault() 
        }}
        className="px-2 py-1 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs font-bold rounded hover:bg-red-200 dark:hover:bg-red-900 transition"
        title="Antwort löschen"
      >
        🗑️
      </button>
    </form>
  )
}