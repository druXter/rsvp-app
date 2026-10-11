// app/admin/events/[id]/einladungen/invitation-forms.tsx
'use client'

import { useActionState } from 'react'
import { addInvitations, removeInvitation, saveInvitation, type InvitationFormState } from '../../../invitation-actions'
import SubmitButton from '../../../../ui/submit-button'
import { buttonClass, hintClass, inputClass, labelClass } from '../../../../ui/kit'

const input = inputClass
const label = labelClass

function Feedback({ state, success }: { state: InvitationFormState; success: string | null }) {
  if (state?.error) return <p role="alert" className="text-sm bg-red-50 text-red-800 p-3 rounded border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{state.error}</p>
  if (success) return <p role="status" className="text-sm bg-green-50 text-green-800 p-3 rounded border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">{success}</p>
  return null
}

/** Ein Termin einer Reihe zur Auswahl (Einladung zu ausgewählten Terminen). */
export type TerminOption = { id: string; label: string }

/**
 * Bei Reihen: zu welchen Terminen die Einladung gilt - alle (auch künftige) oder ausgewählte. Felder allEvents
 * ("1"/"0") und invitationEvent (gelesen von readInvitationEvents in app/admin/invitation-actions.ts).
 */
function TerminSelection({ idPrefix, termine, allEvents, eventIds }: { idPrefix: string; termine: TerminOption[]; allEvents: boolean; eventIds: string[] }) {
  return (
    <fieldset className="space-y-1" data-testid="termin-selection">
      <legend className={label}>Eingeladen zu</legend>
      <input type="hidden" name="allEventsShown" value="1" />
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="allEvents" value="1" defaultChecked={allEvents} /> allen Terminen (auch künftigen)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="allEvents" value="0" defaultChecked={!allEvents} /> nur diesen:
      </label>
      <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
        {termine.map(t => (
          <label key={t.id} htmlFor={`${idPrefix}-${t.id}`} className="flex items-center gap-1.5 text-sm">
            <input id={`${idPrefix}-${t.id}`} type="checkbox" name="invitationEvent" value={t.id} defaultChecked={eventIds.includes(t.id)} /> {t.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Viele Einladungen auf einmal, eine Zeile pro Haushalt (parseInvitationLines in app/lib/invitations.ts). Für ein
 * Einzel-Event (eventId) oder eine Reihe (seriesId, mit Auswahl der Termine).
 */
export function AddInvitationsForm({ eventId, seriesId, termine = [] }: { eventId?: string; seriesId?: string; termine?: TerminOption[] }) {
  const [state, action, pending] = useActionState<InvitationFormState, FormData>(addInvitations, null)
  return (
    <form action={action} className="space-y-2">
      {eventId && <input type="hidden" name="eventId" value={eventId} />}
      {seriesId && <input type="hidden" name="seriesId" value={seriesId} />}
      <label htmlFor="invitations" className={label}>Neue Einladungen, eine Zeile pro Haushalt</label>
      <textarea id="invitations" name="invitations" rows={5} className={input} placeholder={'Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind), Dora (Kleinkind)\nTante Erna; erna@example.org; +1\nJonas; Jonas, Lea'} />
      <p className={hintClass}>
        Bezeichnung; danach in beliebiger Reihenfolge und optional: E-Mail, Personen (mit Komma getrennt, „(Kind)“ oder „(Kleinkind)“ dahinter), „+1“ für Personen, die der Haushalt selbst dazu eintragen darf. Ohne Personen ist die Bezeichnung die eingeladene Person.
      </p>
      {seriesId && <TerminSelection idPrefix="new" termine={termine} allEvents eventIds={[]} />}
      <Feedback state={state} success={state?.added ? `✅ ${state.added} Einladung(en) angelegt.` : null} />
      <SubmitButton>{pending ? 'Wird angelegt…' : 'Einladungen anlegen'}</SubmitButton>
    </form>
  )
}

/**
 * Eine Einladung bearbeiten. Personen in Reihenfolge - eine umbenannte Person behält ihre Antwort. Bei Reihen
 * (termine) auch die Termine; Antworten zu abgewählten Terminen fallen weg.
 */
export function EditInvitationForm({ invitation, termine }: {
  invitation: { id: string; label: string; email: string | null; persons: string; extraPersons: number; note: string | null; allEvents?: boolean; eventIds?: string[] }
  termine?: TerminOption[]
}) {
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
        <p className={hintClass}>Die Reihenfolge zählt: Eine umbenannte Person behält ihre Antwort, eine entfernte verliert sie.</p>
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
      {termine && (
        <>
          <TerminSelection idPrefix={`edit-${invitation.id}`} termine={termine} allEvents={invitation.allEvents ?? true} eventIds={invitation.eventIds ?? []} />
          <p className={hintClass}>Antworten zu Terminen, die ihr hier abwählt, werden gelöscht.</p>
        </>
      )}
      <Feedback state={state} success={state?.saved ? '✅ Gespeichert.' : null} />
      <button type="submit" disabled={pending} className={buttonClass('primary', 'sm')}>Speichern</button>
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
        className={buttonClass('danger', 'sm')}
        aria-label={`Einladung ${name} löschen`}
      >
        🗑️
      </button>
    </form>
  )
}
