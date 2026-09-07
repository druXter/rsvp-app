// app/mein-konto/delete-account-button.tsx
'use client'

import { deleteGuestAccount } from './actions'

/**
 * Löscht das gesamte Nutzer-Konto samt aller Reihen-Zuordnungen und Antworten
 * unwiderruflich (Recht auf Löschung, Art. 17 DSGVO). Beinhaltet eine
 * Sicherheitsabfrage im Browser, gleiches Muster wie die Admin-Delete-Buttons.
 */
export default function DeleteAccountButton() {
  return (
    <form
      action={deleteGuestAccount}
      onSubmit={(e) => {
        if (!window.confirm('Konto wirklich unwiderruflich löschen? Das entfernt deine Angaben, alle Reihen-Zuordnungen und alle deine Antworten zu jedem Termin jeder Reihe.')) {
          e.preventDefault()
        }
      }}
    >
      <button type="submit" className="text-sm text-red-600 hover:text-red-800 hover:underline transition">
        🗑️ Konto & alle Daten unwiderruflich löschen
      </button>
    </form>
  )
}
