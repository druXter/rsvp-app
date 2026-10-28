// app/lib/manual-rsvp.ts
//
// Gäste von Hand eintragen (Reiter „Gäste“): Die Verwaltung trägt eine Antwort ein, die sie auf anderem Weg bekommen
// hat (Telefon, persönlich). Reine Eingabeprüfung, gespeichert wird in app/admin/manual-rsvp-actions.ts.
import { InputError } from './input-error'
import { formString } from './form'

const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/

export type ManualStatus = 'yes' | 'maybe' | 'no'

export type ManualRsvpInput = {
  name: string
  status: ManualStatus
  email: string | null
  /** Adresse gilt als bestätigt - nur mit Haken und nur mit Adresse. */
  emailVerified: boolean
  ticketCategoryId: string | null
}

/** Liest das Formular „Gast eintragen“. Wirft InputError, bevor etwas gespeichert ist. */
export function readManualRsvp(formData: FormData): ManualRsvpInput {
  const name = formString(formData, 'name', 100)
  if (!name) throw new InputError('Bitte einen Namen angeben.')
  const status = formData.get('status')
  if (status !== 'yes' && status !== 'maybe' && status !== 'no') throw new InputError('Bitte Zusage, Vielleicht oder Absage wählen.')
  const email = formString(formData, 'email', 255).toLowerCase() || null
  if (email && !EMAIL.test(email)) throw new InputError(`„${email}“ ist keine gültige E-Mail-Adresse.`)
  return {
    name,
    status,
    email,
    emailVerified: !!email && formData.get('emailVerified') === 'on',
    ticketCategoryId: formString(formData, 'ticketCategoryId', 50) || null
  }
}
