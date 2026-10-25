// app/admin/linked-create.tsx
import { toolDefinition } from '../lib/linked-tools'
import { linkedCreateStatus, type CreatableTool } from '../lib/linked-create'
import { buttonClass, hintClass } from '../ui/kit'

/** id des eigenen Formulars für „… anlegen“ - liegt außerhalb des Einstellungs-Formulars (LinkedCreateForm). */
export const LINKED_CREATE_FORM = 'linked-create-form'

const NAME: Record<CreatableTool, { label: string; inTool: string }> = {
  timeline: { label: 'Im Zeitplan anlegen', inTool: 'im Zeitplan' },
  shifts: { label: 'In Schichten anlegen', inTool: 'in Schichten' },
  wichteln: { label: 'In Wichteln anlegen', inTool: 'in Wichteln' }
}

/** Formular, an das die Knöpfe „… anlegen“ senden (Feld `tool` kommt vom Knopf). Neben, nicht in den Einstellungen. */
export function LinkedCreateForm({ eventId, action }: { eventId: string; action: (formData: FormData) => Promise<void> }) {
  return (
    <form id={LINKED_CREATE_FORM} action={action} className="hidden">
      <input type="hidden" name="eventId" value={eventId} />
    </form>
  )
}

/**
 * Knopf zum Anlegen beim Tool unter „Verknüpfungen“ (Idee Q1), solange der Termin dort nicht verknüpft ist. Fragt das
 * Tool vorher, ob das Konto dort anlegen darf - sonst ein Hinweis mit Anmelde-Link statt des Knopfs. Wird in einem
 * Suspense-Rahmen geladen, damit ein langsames Tool die Seite nicht aufhält.
 */
export async function LinkedCreateButton({ type, eventId, userId }: { type: CreatableTool; eventId: string; userId: string }) {
  const { label: toolLabel } = toolDefinition(type)
  const { label, inTool } = NAME[type]
  const result = await linkedCreateStatus(type, eventId, userId)
  if (!result) return <p className={hintClass}>{toolLabel} ist gerade nicht erreichbar - anlegen geht später, verknüpfen von Hand jederzeit.</p>

  const button = (text: string) => (
    <button type="submit" form={LINKED_CREATE_FORM} name="tool" value={type} className={buttonClass('secondary', 'sm')}>{text}</button>
  )
  switch (result.status) {
    case 'ready':
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {button(label)}
          <span className={`${hintClass} mt-0`}>oder den Link von Hand eintragen. Legt {inTool} ein Event mit Titel und Datum dieses Termins an, als Entwurf und gleich verknüpft.</span>
        </div>
      )
    case 'linked':
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {button('Verknüpfen')}
          <span className={`${hintClass} mt-0`}>{toolLabel} hat schon ein Event zu diesem Termin.</span>
        </div>
      )
    case 'no-account':
      return (
        <p className={hintClass}>
          Zum Anlegen {inTool} brauchst du dort ein Konto, das mit diesem verbunden ist:{' '}
          <a href={result.loginUrl} target="_blank" rel="noopener noreferrer" className="underline">einmal {inTool} mit deinem Konto von hier anmelden</a>, danach diese Seite neu laden.
        </p>
      )
    case 'no-permission':
      return <p className={hintClass}>Dein Konto {inTool} darf keine Events anlegen (Moderator*in).</p>
    case 'taken':
      return <p className={hintClass}>{toolLabel} hat schon ein Event zu diesem Termin, das du dort nicht verwaltest.</p>
    default:
      return null
  }
}
