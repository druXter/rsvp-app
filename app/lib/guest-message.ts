// app/lib/guest-message.ts
//
// Nachricht an Gäste (Idee L29 der Suite): freie Mail und Push der Verwaltung an eine gefilterte Auswahl der Antworten
// eines Termins. Rein, ohne Datenbank - die Seite zählt damit live mit (Vorschau), die Server Action wählt damit aus
// (app/admin/message-actions.ts). Wer was bekommt, gilt wie bei der Änderungs-Mail (app/lib/event-change-notify.ts).
import { paymentDue, type PaymentFields } from './payment-state'

export const MAX_MESSAGE_SUBJECT = 150
export const MAX_MESSAGE_BODY = 5000
/** So viele Nachrichten pro Termin in 24 Stunden - Schutz vor Doppelklicks und dem Versandlimit des Postfachs. */
export const MAX_MESSAGES_PER_DAY = 10

export type MessageGroup = 'attending' | 'waitlist' | 'maybe'
export const GROUP_LABEL: Record<MessageGroup, string> = { attending: 'Zusagen', waitlist: 'Warteliste', maybe: 'Vielleicht' }

export type MessageAudience = {
  groups: MessageGroup[]
  /** Nur diese Ticketkategorie (null = alle). */
  categoryId: string | null
  /** Nur Zusagen mit offener oder überfälliger Zahlung. */
  unpaidOnly: boolean
  /** Einlass: alle, nur eingecheckte (da gewesen) oder nur nicht eingecheckte. */
  checkin: 'all' | 'in' | 'out'
}

export type MessageRsvp = PaymentFields & {
  isAttending: boolean
  isMaybe: boolean
  isOnWaitlist: boolean
  hasAttended: boolean
  ticketCategoryId: string | null
  participant: { email: string | null; isVerified: boolean }
}

/** Gruppe einer Antwort; null = Absage (bekommt nie eine Nachricht). */
export function groupOf(r: { isAttending: boolean; isMaybe: boolean; isOnWaitlist: boolean }): MessageGroup | null {
  if (r.isAttending) return r.isOnWaitlist ? 'waitlist' : 'attending'
  return r.isMaybe ? 'maybe' : null
}

export function matchesAudience(r: MessageRsvp, audience: MessageAudience, now = new Date()): boolean {
  const group = groupOf(r)
  if (!group || !audience.groups.includes(group)) return false
  if (audience.categoryId && r.ticketCategoryId !== audience.categoryId) return false
  if (audience.unpaidOnly && !paymentDue(r, now)) return false
  if (audience.checkin === 'in' && !r.hasAttended) return false
  if (audience.checkin === 'out' && r.hasAttended) return false
  return true
}

/**
 * Wer bekommt die Nachricht und auf welchem Weg? Wie bei Änderungen: Mail nur an eine hinterlegte Adresse, bei Terminen
 * mit E-Mail-Bestätigung nur an bestätigte; Push an alle Abos, deren Antwort (falls nötig) bestätigt ist. „Vielleicht“
 * braucht immer eine bestätigte Adresse (app/lib/maybe.ts) - ohne gilt die Antwort noch nicht.
 */
export function selectRecipients<T extends MessageRsvp>(rsvps: readonly T[], audience: MessageAudience, requireVerification: boolean, now = new Date()) {
  const chosen = rsvps
    .filter(r => matchesAudience(r, audience, now))
    .filter(r => groupOf(r) !== 'maybe' || r.participant.isVerified)
    .filter(r => !requireVerification || r.participant.isVerified)
  return { all: chosen, mail: chosen.filter(r => !!r.participant.email?.trim()) }
}

/** Liest die Auswahl aus dem Formular; null, wenn keine Gruppe gewählt ist. Unbekannte Werte fallen auf "alle". */
export function readAudience(formData: FormData, categoryIds: readonly string[]): MessageAudience | null {
  const groups = (Object.keys(GROUP_LABEL) as MessageGroup[]).filter(g => formData.get(`group_${g}`) === 'on')
  if (groups.length === 0) return null
  const category = formData.get('categoryId')
  const checkin = formData.get('checkin')
  return {
    groups,
    categoryId: typeof category === 'string' && categoryIds.includes(category) ? category : null,
    unpaidOnly: formData.get('unpaidOnly') === 'on',
    checkin: checkin === 'in' || checkin === 'out' ? checkin : 'all'
  }
}

/** Kurzbeschreibung der Auswahl für den Verlauf: "Zusagen, Warteliste · Kategorie Studi · nur offene Zahlung". */
export function describeAudience(audience: MessageAudience, categoryLabel: string | null): string {
  return [
    audience.groups.map(g => GROUP_LABEL[g]).join(', '),
    audience.categoryId && `Kategorie ${categoryLabel ?? '(gelöscht)'}`,
    audience.unpaidOnly && 'nur offene Zahlung',
    audience.checkin === 'in' && 'nur eingecheckt',
    audience.checkin === 'out' && 'nur nicht eingecheckt'
  ].filter(Boolean).join(' · ')
}

/** Absätze des Nachrichtentexts: durch Leerzeilen getrennt, einzelne Zeilenumbrüche bleiben im Absatz. */
export function messageParagraphs(body: string): string[] {
  return body.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}
