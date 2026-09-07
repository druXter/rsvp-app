'use client'

import { deleteUser } from './actions'

/**
 * Löscht ein Benutzerkonto unwiderruflich inkl. aller eigenen Events, Reihen und
 * Antworten. Beinhaltet eine Sicherheitsabfrage im Browser. Admin-Konten lassen sich
 * über diesen Button gar nicht erst löschen (siehe Aufrufer in app/admin/users/page.tsx).
 */
export default function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  return (
    <form action={deleteUser} onSubmit={(e) => {
      if (!window.confirm(`Konto ${email} wirklich unwiderruflich löschen? Alle eigenen Events, Reihen, Antworten und Gast-Profile gehen dabei verloren!`)) {
        e.preventDefault()
      }
    }}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded hover:bg-red-200 transition">
        🗑️ Löschen
      </button>
    </form>
  )
}
