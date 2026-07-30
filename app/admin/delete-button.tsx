// app/admin/delete-button.tsx
'use client' // Definiert diese Komponente als Client-Side, da Browser-APIs (window.confirm) verwendet werden.

import { deleteEvent } from './actions'

/**
 * Button-Komponente zum Löschen eines kompletten Events.
 * Beinhaltet eine Sicherheitsabfrage im Browser, bevor die serverseitige Lösch-Aktion ausgelöst wird.
 */
export default function DeleteButton({ eventId }: { eventId: string }) {
  return (
    <form action={deleteEvent} onSubmit={(e) => {
      // Verhindert das Absenden des Formulars, wenn der Nutzer im Dialog auf "Abbrechen" klickt
      if (!window.confirm('Event wirklich löschen? Alle Antworten gehen verloren!')) {
        e.preventDefault()
      }
    }}>
      {/* Verstecktes Feld zur Übergabe der Event-ID an die Server-Action */}
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded hover:bg-red-200 transition">
        🗑️ Löschen
      </button>
    </form>
  )
}