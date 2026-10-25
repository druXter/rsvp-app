// app/admin/account-invite-picker.tsx
'use client'

import { useState } from 'react'
import { hintClass, inputClass } from '../ui/kit'

export type PickerCandidate = { id: string; name: string; email: string; sources: string[] }

/**
 * Auswahl der Teilnehmendenkonten, die eingeladen werden sollen (app/lib/guest-invites.ts): durchsuchbar nach Name,
 * Adresse und Herkunft, je Konto ein Häkchen (Feld `inviteGuestUser`), dazu „per Mail benachrichtigen“ (Feld
 * `notifyInvites`). Steht in einem Formular - beim Anlegen eines Events und im Reiter „Gäste“.
 */
export default function AccountInvitePicker({ candidates }: { candidates: PickerCandidate[] }) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const q = query.trim().toLowerCase()
  const visible = q
    ? candidates.filter(c => [c.name, c.email, ...c.sources].some(text => text.toLowerCase().includes(q)))
    : candidates
  const toggle = (id: string, on: boolean) => setChosen(current => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  return (
    <div className="space-y-3">
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, E-Mail oder Event suchen"
        aria-label="Konten durchsuchen" className={inputClass} />
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700" data-testid="invite-candidates">
        {visible.map(c => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900">
              <input type="checkbox" name="inviteGuestUser" value={c.id} checked={chosen.has(c.id)} onChange={e => toggle(c.id, e.target.checked)}
                className="mt-1 h-4 w-4 accent-blue-600" aria-label={`${c.name} (${c.email})`} />
              <span className="min-w-0">
                <span className="block text-sm text-gray-900 dark:text-gray-100">{c.name} <span className="text-gray-500 dark:text-gray-400">{c.email}</span></span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">aus {c.sources.join(', ')}</span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && <li className={`${hintClass} px-2 py-1.5`}>Kein Konto passt zur Suche.</li>}
      </ul>
      {/* Gewählte, die die Suche gerade ausblendet, gehen trotzdem mit */}
      {[...chosen].filter(id => !visible.some(c => c.id === id)).map(id => <input key={id} type="hidden" name="inviteGuestUser" value={id} />)}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${hintClass} mt-0`}>{chosen.size === 0 ? 'Keins ausgewählt' : chosen.size === 1 ? '1 Konto ausgewählt' : `${chosen.size} Konten ausgewählt`}</span>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" name="notifyInvites" defaultChecked className="h-4 w-4 accent-blue-600" />
          per Mail benachrichtigen
        </label>
      </div>
    </div>
  )
}
