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
  /** Mail wie bei einer Antwort über das Formular schicken - nur mit Adresse. */
  sendMail: boolean
  ticketCategoryId: string | null
}

/** Welche Mail beim Eintragen rausgeht (sendMail): wie nach einer Antwort über das Formular. */
export type ManualMail = 'confirmation' | 'verification' | 'maybe-verification' | null

/**
 * Zusage: Bestätigung (Kalenderdatei, Einlass-QR-Code, Zahlungsdaten) - fehlt mit Verifizierungs-Pflicht die bestätigte
 * Adresse, erst die Bitte um Bestätigung (die Bestätigung folgt nach dem Klick). Vielleicht: Bitte um Bestätigung, wenn
 * die Adresse noch nicht bestätigt ist (sonst keine Erinnerung). Absage: keine Mail.
 */
export function manualMailOf(input: Pick<ManualRsvpInput, 'status' | 'email' | 'emailVerified' | 'sendMail'>, requireVerification: boolean): ManualMail {
  if (!input.sendMail || !input.email) return null
  if (input.status === 'yes') return requireVerification && !input.emailVerified ? 'verification' : 'confirmation'
  if (input.status === 'maybe') return input.emailVerified ? null : 'maybe-verification'
  return null
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
    sendMail: !!email && formData.get('sendMail') === 'on',
    ticketCategoryId: formString(formData, 'ticketCategoryId', 50) || null
  }
}

/** Gleiche Adresse? Groß-/Kleinschreibung und Leerzeichen zählen nicht. */
function sameEmail(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/**
 * Bestätigung der Adresse beim Bearbeiten einer Antwort (updateAdminRsvp): Mit Haken gilt die Adresse als bestätigt.
 * Ohne Haken bleibt eine unveränderte Adresse, wie sie ist; eine geänderte (oder gelöschte) ist danach unbestätigt -
 * die Bestätigung galt der alten. Ein offener Bestätigungslink verfällt mit jeder Änderung, er gehörte zur alten
 * Adresse. Gibt nur die zu ändernden Felder zurück, null = nichts ändern.
 */
export function verificationAfterAdminEdit(
  existing: { email: string | null; isVerified: boolean },
  email: string | null,
  markVerified: boolean,
  now = new Date()
): { isVerified: boolean; verifiedAt: Date | null; verifyToken: null } | null {
  const changed = !sameEmail(existing.email, email)
  if (markVerified && email) return existing.isVerified && !changed ? null : { isVerified: true, verifiedAt: now, verifyToken: null }
  return changed ? { isVerified: false, verifiedAt: null, verifyToken: null } : null
}
