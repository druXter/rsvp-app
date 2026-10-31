'use client'
// app/ui/reconfirm-box.tsx

import { useActionState } from 'react'
import { answerReconfirm, type ReconfirmState } from '../actions'
import { buttonClass, Notice } from './kit'

/**
 * Rückbestätigung (Idee L30, app/lib/reconfirm.ts): „Kommst du noch?“ über dem Formular, solange die eigene feste Zusage
 * noch nicht bestätigt ist. Bleibt nach der Antwort eingehängt (`pending` false), damit die Rückmeldung nach dem
 * Neuladen der Seite stehen bleibt. Die Entscheidung trifft answerReconfirm auf dem Server.
 */
export default function ReconfirmBox({ eventId, editToken, pending, deadline, autoDecline, className = 'mb-4' }: {
  eventId: string
  editToken: string
  pending: boolean
  /** Frist als Text; null, wenn sie schon vorbei ist */
  deadline: string | null
  autoDecline: boolean
  className?: string
}) {
  const [state, answer, busy] = useActionState<ReconfirmState, FormData>(answerReconfirm, null)

  if (state?.status === 'confirmed') return <Notice tone="success" testId="reconfirm-result" className={className}>Danke! Dein Platz ist bestätigt - bis bald.</Notice>
  if (state?.status === 'declined') return <Notice tone="info" testId="reconfirm-result" className={className}>Schade - du bist jetzt abgesagt und dein Platz ist frei für andere. Wenn du doch kommen möchtest, kannst du unten wieder zusagen.</Notice>
  if (!pending) return null

  return (
    <section className={`${className} rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800`} data-testid="reconfirm-box" aria-labelledby="reconfirm-title">
      <h2 id="reconfirm-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Kommst du noch?</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Du hast zugesagt. Damit kein Platz leer bleibt, bestätige bitte kurz{deadline ? ` bis ${deadline}` : ''}.
        {autoDecline && deadline ? ' Ohne Bestätigung geben wir deinen Platz an die Warteliste.' : ''}
      </p>
      {state?.status === 'invalid' && <Notice tone="error" className="mt-3">Das hat nicht geklappt. Bitte lade die Seite neu.</Notice>}
      <form action={answer} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="editToken" value={editToken} />
        <button type="submit" name="answer" value="yes" disabled={busy} className={buttonClass('primary')}>Ja, ich komme</button>
        <button type="submit" name="answer" value="no" disabled={busy} className={buttonClass('secondary')}>Nein, ich kann nicht</button>
      </form>
    </section>
  )
}
