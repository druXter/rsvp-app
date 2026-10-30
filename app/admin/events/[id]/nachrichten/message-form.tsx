// app/admin/events/[id]/nachrichten/message-form.tsx
'use client'

import { useActionState, useState, useTransition, type FormEvent } from 'react'
import { sendGuestMessage } from '../../../message-actions'
import { GROUP_LABEL, MAX_MESSAGE_BODY, MAX_MESSAGE_SUBJECT, selectRecipients, type MessageAudience, type MessageGroup, type MessageRsvp } from '../../../../lib/guest-message'
import { buttonClass, hintClass, inputClass, labelClass } from '../../../../ui/kit'

/**
 * Formular „Nachricht an Gäste“ (Idee L29): Auswahl, Betreff, Text. Zählt live mit, wie viele die Nachricht
 * bekommen (dieselbe Funktion wie die Server Action, ohne Namen und Adressen - `rows` trägt nur, was die Auswahl
 * braucht), und fragt vor dem Versand nach. Nach einem Fehler bleibt alles stehen.
 */
export default function MessageForm({ eventId, rows, requireVerification, categories, payments, checkin }: {
  eventId: string
  rows: MessageRsvp[]
  requireVerification: boolean
  categories: { id: string; label: string }[]
  payments: boolean
  checkin: boolean
}) {
  const [state, formAction, pending] = useActionState(sendGuestMessage, null)
  const [, startTransition] = useTransition()
  const [audience, setAudience] = useState<MessageAudience>({ groups: ['attending'], categoryId: null, unpaidOnly: false, checkin: 'all' })
  const { all, mail } = selectRecipients(rows, audience, requireVerification)
  const toggle = (group: MessageGroup, on: boolean) =>
    setAudience(a => ({ ...a, groups: on ? [...a.groups, group] : a.groups.filter(g => g !== group) }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!window.confirm(`Nachricht jetzt an ${all.length} ${all.length === 1 ? 'Antwort' : 'Antworten'} senden (${mail.length} per Mail, dazu Push)?`)) return
    const data = new FormData(event.currentTarget)
    startTransition(() => formAction(data))
  }

  return (
    <form action={formAction} onSubmit={submit} aria-busy={pending} className="space-y-4" data-testid="message-form">
      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="message-error">
          ⚠️ Nicht gesendet: {state.error}
        </p>
      )}
      <input type="hidden" name="eventId" value={eventId} />
      <fieldset className="space-y-2">
        <legend className={labelClass}>An</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(GROUP_LABEL) as MessageGroup[]).map(group => (
            <label key={group} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`group_${group}`} checked={audience.groups.includes(group)} onChange={e => toggle(group, e.target.checked)} /> {GROUP_LABEL[group]}
            </label>
          ))}
        </div>
      </fieldset>
      {(categories.length > 0 || checkin) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.length > 0 && (
            <div>
              <label htmlFor="message-category" className={labelClass}>Ticketkategorie</label>
              <select id="message-category" name="categoryId" value={audience.categoryId ?? ''} onChange={e => setAudience(a => ({ ...a, categoryId: e.target.value || null }))} className={inputClass}>
                <option value="">Alle</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          )}
          {checkin && (
            <div>
              <label htmlFor="message-checkin" className={labelClass}>Einlass</label>
              <select id="message-checkin" name="checkin" value={audience.checkin} onChange={e => setAudience(a => ({ ...a, checkin: e.target.value as MessageAudience['checkin'] }))} className={inputClass}>
                <option value="all">Alle</option>
                <option value="in">Nur eingecheckte</option>
                <option value="out">Nur nicht eingecheckte</option>
              </select>
            </div>
          )}
        </div>
      )}
      {payments && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="unpaidOnly" checked={audience.unpaidOnly} onChange={e => setAudience(a => ({ ...a, unpaidOnly: e.target.checked }))} /> Nur mit offener Zahlung
        </label>
      )}
      <div>
        <label htmlFor="message-subject" className={labelClass}>Betreff</label>
        <input id="message-subject" name="subject" required maxLength={MAX_MESSAGE_SUBJECT} placeholder="z.B. Bitte Ausweis mitbringen" className={inputClass} />
      </div>
      <div>
        <label htmlFor="message-body" className={labelClass}>Text</label>
        <textarea id="message-body" name="body" required rows={7} maxLength={MAX_MESSAGE_BODY} className={inputClass} />
        <p className={hintClass}>Absätze durch eine Leerzeile trennen. Die Mail beginnt mit „Hallo &lt;Name&gt;,“ und endet mit Datum, Ort und dem Link zur Anmeldung.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || all.length === 0} className={buttonClass('primary')}>{pending ? 'Wird gesendet…' : `An ${all.length} senden`}</button>
        <span className="text-sm text-gray-600 dark:text-gray-400" data-testid="message-count">
          {all.length} {all.length === 1 ? 'Antwort' : 'Antworten'} · {mail.length} per Mail{all.length > mail.length ? `, ${all.length - mail.length} ohne Adresse (nur Push)` : ''}
        </span>
      </div>
    </form>
  )
}
