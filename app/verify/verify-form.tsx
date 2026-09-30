// app/verify/verify-form.tsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { confirmParticipantVerification, type ParticipantVerificationState } from '../actions'
import StatusCard from '../ui/status-card'
import SubmitButton from '../ui/submit-button'

/**
 * "Jetzt bestätigen" für das Double-Opt-In einer Zusage (siehe app/verify/page.tsx) und danach
 * das Ergebnis - direkt aus dem Rückgabewert der Action, damit der Token nicht in einer weiteren
 * URL landen muss.
 */
export default function VerifyForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ParticipantVerificationState, FormData>(confirmParticipantVerification, { status: 'idle' })

  if (state.status === 'invalid') {
    return (
      <StatusCard title="Ungültiger Link" tone="error">
        <p>Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.</p>
      </StatusCard>
    )
  }

  if (state.status === 'done') {
    const { results, editToken } = state
    const first = results[0]
    const link = first
      ? first.seriesSlug ? `/reihe/${first.seriesSlug}/${first.slug}?token=${editToken}` : `/${first.slug}?token=${editToken}`
      : null
    return (
      <StatusCard title="Erfolgreich bestätigt! 🎉" tone="success">
        <p className="mb-6">
          Deine E-Mail-Adresse wurde verifiziert{results.length === 1 && (
            <> und deine Anmeldung für <strong>{results[0].title}</strong> ist nun gültig</>
          )}.
        </p>

        {results.length > 1 && (
          <div className="text-left mb-6 space-y-2">
            {results.map(r => (
              <div key={r.slug} className={`text-sm p-3 rounded ${r.isOnWaitlist ? 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' : 'bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                <strong>{r.title}</strong>: {r.isOnWaitlist ? 'Warteliste' : 'Bestätigt'}
              </div>
            ))}
          </div>
        )}

        {results.length === 1 && results[0].isOnWaitlist && (
          <p className="text-sm text-orange-600 font-bold mb-6 bg-orange-50 dark:bg-orange-950 dark:text-orange-300 p-3 rounded">
            Du stehst aktuell auf der Warteliste. Wir haben dir dazu eine E-Mail gesendet.
          </p>
        )}
        {results.length === 1 && !results[0].isOnWaitlist && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Wir haben dir soeben die finale Bestätigung inkl. Kalendereintrag per E-Mail gesendet.
          </p>
        )}

        {link && (
          <Link href={link} className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
            Zurück zu deiner Anmeldung
          </Link>
        )}
      </StatusCard>
    )
  }

  return (
    <StatusCard title="Anmeldung bestätigen" tone="neutral">
      <p className="mb-6">Bitte bestätige mit einem Klick, dass dies deine E-Mail-Adresse ist - erst danach ist deine Anmeldung gültig.</p>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton disabled={pending}>{pending ? 'Wird bestätigt …' : 'Jetzt bestätigen'}</SubmitButton>
      </form>
    </StatusCard>
  )
}
