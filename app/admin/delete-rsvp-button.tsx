// app/admin/delete-rsvp-button.tsx
'use client'

import { deleteRsvp } from './actions'
import { buttonClass } from '../ui/kit'

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
        className={buttonClass('danger', 'sm')}
        title="Antwort löschen" aria-label="Antwort löschen"
      >
        🗑️
      </button>
    </form>
  )
}