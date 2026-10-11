// app/admin/settings-form.tsx
'use client'

import { createContext, useActionState, useContext, useEffect, useRef, useTransition, type ComponentProps, type FormEvent } from 'react'
import type { SettingsState } from './actions'

const ErrorContext = createContext<string | null>(null)

/**
 * Formular der Einstellungen (Event, Termin, Reihe) mit Fehlermeldung statt Absturz: Die Server Action gibt eine
 * ungültige Eingabe als `{ error }` zurück (settingsResult in app/admin/actions.ts), SettingsError zeigt sie an.
 * Abgeschickt wird per onSubmit statt über die Form-Action, damit React das Formular nach einem Fehler nicht
 * zurücksetzt - alle Eingaben bleiben stehen. Ohne JavaScript greift die normale Form-Action.
 */
export function SettingsForm({ action, children, ...props }: Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (state: SettingsState, formData: FormData) => Promise<SettingsState>
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const [, startTransition] = useTransition()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    startTransition(() => formAction(data))
  }
  return (
    <ErrorContext value={state?.error ?? null}>
      <form {...props} action={formAction} onSubmit={submit} aria-busy={pending}>{children}</form>
    </ErrorContext>
  )
}

/** Meldung der letzten fehlgeschlagenen Speicherung, scrollt beim Erscheinen in den Blick. */
export function SettingsError() {
  const error = useContext(ErrorContext)
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [error])
  if (!error) return null
  return (
    <p ref={ref} role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="settings-error">
      ⚠️ Nicht gespeichert: {error}
    </p>
  )
}
