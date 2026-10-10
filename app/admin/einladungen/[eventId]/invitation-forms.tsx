// app/admin/einladungen/[eventId]/invitation-forms.tsx
'use client'

import { useActionState } from 'react'
import { addInvitations, removeInvitation, saveInvitation, type InvitationFormState } from '../../invitation-actions'
import SubmitButton from '../../../ui/submit-button'
import { themeClasses } from '../../../ui/theme-section'

const input = `w-full border ${themeClasses('indigo').border} bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded outline-none ${themeClasses('indigo').borderFocus}`
const label = `block text-sm font-medium mb-1 ${themeClasses('indigo').heading}`

function Feedback({ state, success }: { state: InvitationFormState; success: string | null }) {
  if (state?.error) return <p role="alert" className="text-sm bg-red-50 text-red-800 p-3 rounded border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{state.error}</p>
  if (success) return <p role="status" className="text-sm bg-green-50 text-green-800 p-3 rounded border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">{success}</p>
  return null
}

/** Viele Einladungen auf einmal, eine Zeile pro Haushalt (parseInvitationLines in app/lib/invitations.ts). */
export function AddInvitationsForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState<InvitationFormState, FormData>(addInvitations, null)
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <label htmlFor="invitations" className={label}>Neue Einladungen, eine Zeile pro Haushalt</label>
      <textarea id="invitations" name="invitations" rows={5} className={input} placeholder={'Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind), Dora (Kleinkind)\nTante Erna; erna@example.org; +1\nJonas; Jonas, Lea'} />
      <p className={`text-xs ${themeClasses('indigo').text}`}>
        Bezeichnung; danach in beliebiger Reihenfolge und optional: E-Mail, Personen (mit Komma getrennt, „(Kind)“ oder „(Kleinkind)“ dahinter), „+1“ für Personen, die der Haushalt selbst dazu eintragen darf. Ohne Personen ist die Bezeichnung die eingeladene Person.
      </p>
      <Feedback state={state} success={state?.added ? `✅ ${state.added} Einladung(en) angelegt.` : null} />
      <SubmitButton>{pending ? 'Wird angelegt…' : 'Einladungen anlegen'}</SubmitButton>
    </form>
  )
}

/** Eine Einladung bearbeiten. Personen in Reihenfolge - eine umbenannte Person behält ihre Antwort. */
export function EditInvitationForm({ invitation }: { invitation: { id: string; label: string; email: string | null; persons: string; extraPersons: number; note: string | null } }) {
  const [state, action, pending] = useActionState<InvitationFormState, FormData>(saveInvitation, null)
  return (
    <form action={action} className="space-y-2 mt-2">
      <input type="hidden" name="invitationId" value={invitation.id} />
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`label-${invitation.id}`} className={label}>Bezeichnung</label>
          <input id={`label-${invitation.id}`} name="label" defaultValue={invitation.label} required maxLength={100} className={input} />
        </div>
        <div>
          <label htmlFor={`email-${invitation.id}`} className={label}>E-Mail (Optional)</label>
          <input id={`email-${invitation.id}`} name="email" type="email" defaultValue={invitation.email ?? ''} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor={`persons-${invitation.id}`} className={label}>Personen (mit Komma getrennt)</label>
        <input id={`persons-${invitation.id}`} name="persons" defaultValue={invitation.persons} required className={input} />
        <p className={`text-xs ${themeClasses('indigo').text} mt-1`}>Die Reihenfolge zählt: Eine umbenannte Person behält ihre Antwort, eine entfernte verliert sie.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`extra-${invitation.id}`} className={label}>Zusatzpersonen</label>
          <input id={`extra-${invitation.id}`} name="extraPersons" type="number" min={0} max={10} defaultValue={invitation.extraPersons} className={input} />
        </div>
        <div>
          <label htmlFor={`note-${invitation.id}`} className={label}>Notiz (nur für euch)</label>
          <input id={`note-${invitation.id}`} name="note" defaultValue={invitation.note ?? ''} maxLength={500} className={input} />
        </div>
      </div>
      <Feedback state={state} success={state?.saved ? '✅ Gespeichert.' : null} />
      <button type="submit" disabled={pending} className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">Speichern</button>
    </form>
  )
}

export function DeleteInvitationButton({ invitationId, label: name }: { invitationId: string; label: string }) {
  return (
    <form action={removeInvitation}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        onClick={e => { if (!confirm(`Einladung „${name}“ samt Antwort wirklich löschen? Der Link funktioniert danach nicht mehr.`)) e.preventDefault() }}
        className="px-2 py-1 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs font-bold rounded hover:bg-red-200 dark:hover:bg-red-900 transition"
        aria-label={`Einladung ${name} löschen`}
      >
        🗑️
      </button>
    </form>
  )
}
