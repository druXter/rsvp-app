// app/lib/payment.ts
//
// Bezahlung per Überweisung (Idee L1 der Suite, docs/KONZEPT-TICKETS.md): kein Zahlungsanbieter. Gäste
// überweisen mit GiroCode und eindeutigem Verwendungszweck, die Verwaltung markiert "bezahlt" (oder "bar
// bezahlt" an der Abendkasse). Der Betrag kommt aus der Ticketkategorie (app/lib/tickets.ts).
import { paymentBox } from './mail-templates'
import { randomInt } from 'node:crypto'
import QRCode from 'qrcode'
import { prisma } from './prisma'
import { formatEuro, formatPaymentDate, paymentDue, paymentState, type PaymentFields, type PaymentState } from './payment-state'
import { InputError } from './input-error'

export { PAYMENT_STATE_LABEL, formatPaymentDate, paymentDue, paymentState, type PaymentFields, type PaymentState } from './payment-state'

// --- Einstellungen pro Termin ---------------------------------------------------------------------

export type PaymentSettings = {
  paymentRecipient: string | null
  paymentIban: string | null
  paymentBic: string | null
  paymentDueDays: number | null
  paymentReminderDays: number | null
}

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

/** IBAN-Prüfsumme (ISO 13616, mod 97). Fängt Tippfehler ab, bevor Gäste an eine falsche IBAN überweisen. */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  if (iban.startsWith('DE') && iban.length !== 22) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** IBAN in Vierergruppen, wie man sie abtippt. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim()
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value)
}

/**
 * Liest die Zahlungseinstellungen aus dem Termin-Formular. null = das Formular hat den Abschnitt nicht (dann
 * bleiben sie unangetastet). `needsPayment`: mindestens eine Kategorie kostet etwas - dann sind Empfänger*in
 * und IBAN Pflicht. Wirft mit einer Meldung fürs Formular.
 */
export function readPaymentSettings(formData: FormData, needsPayment: boolean): PaymentSettings | null {
  if (!formData.has('paymentIban')) return null
  const recipient = String(formData.get('paymentRecipient') ?? '').trim()
  const ibanInput = normalizeIban(String(formData.get('paymentIban') ?? ''))
  const bicInput = String(formData.get('paymentBic') ?? '').replace(/\s+/g, '').toUpperCase()
  const dueInput = String(formData.get('paymentDueDays') ?? '').trim()
  const reminderInput = String(formData.get('paymentReminderDays') ?? '').trim()

  if (recipient.length > 70) throw new InputError('Bezahlung: Der Name der Empfänger*in darf höchstens 70 Zeichen haben (Vorgabe für Überweisungen).')
  if (ibanInput && !isValidIban(ibanInput)) throw new InputError('Bezahlung: Die IBAN ist ungültig (Prüfsumme stimmt nicht).')
  if (bicInput && !isValidBic(bicInput)) throw new InputError('Bezahlung: Die BIC ist ungültig.')
  if (needsPayment && (!recipient || !ibanInput)) {
    throw new InputError('Bezahlung: Mindestens eine Ticketkategorie hat einen Preis - dann sind Empfänger*in und IBAN Pflicht.')
  }
  let paymentDueDays: number | null = null
  if (dueInput) {
    if (!/^\d+$/.test(dueInput) || Number(dueInput) < 1 || Number(dueInput) > 365) throw new InputError('Bezahlung: Die Zahlfrist muss zwischen 1 und 365 Tagen liegen.')
    paymentDueDays = Number(dueInput)
  }
  let paymentReminderDays: number | null = null
  if (reminderInput) {
    if (!/^\d+$/.test(reminderInput) || Number(reminderInput) < 1 || Number(reminderInput) > 60) throw new InputError('Bezahlung: Die Zahlungserinnerung muss zwischen 1 und 60 Tagen vor Fristende liegen.')
    if (paymentDueDays === null) throw new InputError('Bezahlung: Eine automatische Zahlungserinnerung braucht eine Zahlfrist.')
    paymentReminderDays = Number(reminderInput)
  }
  return { paymentRecipient: recipient || null, paymentIban: ibanInput || null, paymentBic: bicInput || null, paymentDueDays, paymentReminderDays }
}

// --- Verwendungszweck und GiroCode ------------------------------------------------------------------

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L), damit man den Code auch abtippen kann
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Eindeutiger Verwendungszweck einer Zusage, z. B. "WINTERBA-7KQ3M2XZ" (Präfix aus dem Slug des Termins). */
export function generatePaymentReference(slug: string): string {
  const prefix = slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TICKET'
  let code = ''
  for (let i = 0; i < 8; i++) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
  return `${prefix}-${code}`
}

export type TransferDetails = {
  recipient: string
  iban: string
  bic: string | null
  amountCents: number
  reference: string
}

/**
 * Inhalt des GiroCodes (EPC QR, Version 002, UTF-8, SEPA-Überweisung) nach EPC069-12. Die BIC ist in
 * Version 002 innerhalb des EWR optional. Der Verwendungszweck steht im unstrukturierten Feld.
 */
export function epcPayload(t: TransferDetails): string {
  const amount = `EUR${(t.amountCents / 100).toFixed(2)}`
  return ['BCD', '002', '1', 'SCT', t.bic ?? '', t.recipient.slice(0, 70), normalizeIban(t.iban), amount, '', '', t.reference.slice(0, 140)].join('\n')
}

export function giroCodeDataUrl(t: TransferDetails): Promise<string> {
  // Fehlerkorrektur M schreibt EPC069-12 vor
  return QRCode.toDataURL(epcPayload(t), { errorCorrectionLevel: 'M', width: 260, margin: 2 })
}

export function giroCodeBuffer(t: TransferDetails): Promise<Buffer> {
  return QRCode.toBuffer(epcPayload(t), { errorCorrectionLevel: 'M', width: 260, margin: 2 })
}

// --- Zahlstatus (reine Funktionen in app/lib/payment-state.ts, auch für Client-Komponenten) -----------

/**
 * Hält paymentDueAt aktuell: Ein fester Platz mit offenem Betrag bekommt eine Frist (falls der Termin eine hat
 * und noch keine gesetzt ist), Warteliste und Absage verlieren sie. Fehlt einer Antwort mit Betrag der
 * Verwendungszweck, wird er nachgetragen (ohne ihn gäbe es keine Zahlungsdaten). Aufrufen, nachdem eine Antwort
 * fest geworden ist (Zusage, Nachrücken, Verifizierung) und bevor die Bestätigung mit der Frist verschickt wird.
 */
export async function syncPaymentDue(where: { rsvpIds: string[] } | { eventId: string }): Promise<void> {
  const rsvps = await prisma.rsvp.findMany({
    where: 'eventId' in where ? { eventId: where.eventId } : { id: { in: where.rsvpIds } },
    select: {
      id: true, isAttending: true, isOnWaitlist: true, amountCents: true, paidAt: true, paymentDueAt: true, paymentReference: true,
      event: { select: { slug: true, paymentDueDays: true } }
    }
  })
  for (const r of rsvps) {
    const data: { paymentDueAt?: Date | null; paymentReference?: string; paymentReminderSentAt?: null } = {}
    const due = !r.paidAt && !!r.amountCents && r.isAttending && !r.isOnWaitlist
    if (due && !r.paymentDueAt && r.event.paymentDueDays) {
      data.paymentDueAt = new Date(Date.now() + r.event.paymentDueDays * 24 * 60 * 60 * 1000)
      // Neue Frist, neue Erinnerung (z. B. erneute Zusage nach einer Stornierung)
      data.paymentReminderSentAt = null
    }
    else if (!due && r.paymentDueAt && !r.paidAt) data.paymentDueAt = null
    if (r.amountCents && !r.paymentReference) data.paymentReference = generatePaymentReference(r.event.slug)
    if (Object.keys(data).length > 0) await prisma.rsvp.update({ where: { id: r.id }, data })
  }
}

// --- Anzeige für Gäste --------------------------------------------------------------------------------

/** Was Gäste zur Zahlung sehen (Event-Seite, Erfolgsseite). Serialisierbar für Client-Komponenten. */
export type PaymentInfo = {
  state: PaymentState
  amount: string
  categoryLabel: string | null
  paidAt: string | null
  method: string | null
  transfer: { recipient: string; iban: string; bic: string | null; reference: string; dueAt: string | null; giroCode: string } | null
}

type EventPaymentFields = { paymentRecipient: string | null; paymentIban: string | null; paymentBic: string | null }

/** Überweisungsdaten einer Antwort, falls eine Zahlung fällig ist und der Termin ein Konto hinterlegt hat. */
export function transferDetailsOf(rsvp: PaymentFields & { paymentReference: string | null }, event: EventPaymentFields): TransferDetails | null {
  if (!paymentDue(rsvp) || !rsvp.paymentReference || !event.paymentIban || !event.paymentRecipient) return null
  return { recipient: event.paymentRecipient, iban: event.paymentIban, bic: event.paymentBic, amountCents: rsvp.amountCents!, reference: rsvp.paymentReference }
}


export async function paymentInfoOf(
  rsvp: PaymentFields & { paymentReference: string | null; paymentMethod: string | null; ticketCategory?: { label: string } | null },
  event: EventPaymentFields
): Promise<PaymentInfo | null> {
  const state = paymentState(rsvp)
  if (state === 'none' || !rsvp.amountCents) return null
  const transfer = transferDetailsOf(rsvp, event)
  return {
    state,
    amount: formatEuro(rsvp.amountCents),
    categoryLabel: rsvp.ticketCategory?.label ?? null,
    paidAt: rsvp.paidAt ? formatPaymentDate(rsvp.paidAt) : null,
    method: rsvp.paymentMethod,
    transfer: transfer && {
      recipient: transfer.recipient,
      iban: formatIban(transfer.iban),
      bic: transfer.bic,
      reference: transfer.reference,
      dueAt: rsvp.paymentDueAt ? formatPaymentDate(rsvp.paymentDueAt) : null,
      giroCode: await giroCodeDataUrl(transfer)
    }
  }
}

// --- Mail ---------------------------------------------------------------------------------------------


/**
 * Zahlungsblock für die Bestätigungs-Mail (Text, HTML und GiroCode als CID-Anhang) - null, wenn nichts zu
 * zahlen ist. Wird beim festen Platz verschickt (Zusage, Nachrücken, Verifizierung), daher mit Frist.
 */
export async function paymentMailParts(rsvp: Parameters<typeof transferDetailsOf>[0] & { ticketCategoryId: string | null }, event: EventPaymentFields) {
  const transfer = transferDetailsOf(rsvp, event)
  if (!transfer) return null
  const category = rsvp.ticketCategoryId
    ? await prisma.ticketCategory.findUnique({ where: { id: rsvp.ticketCategoryId }, select: { label: true } })
    : null
  const amount = `${formatEuro(transfer.amountCents)}${category ? ` (${category.label})` : ''}`
  const due = rsvp.paymentDueAt ? formatPaymentDate(rsvp.paymentDueAt) : null
  const rows: [string, string][] = [
    ['Betrag', amount],
    ['Empfänger*in', transfer.recipient],
    ['IBAN', formatIban(transfer.iban)],
    ...(transfer.bic ? [['BIC', transfer.bic] as [string, string]] : []),
    ['Verwendungszweck', transfer.reference],
    ...(due ? [['Zahlbar bis', due] as [string, string]] : [])
  ]
  const attachment = { filename: 'girocode.png', content: await giroCodeBuffer(transfer), cid: 'girocode', contentType: 'image/png' }
  return { block: paymentBox(rows, true), attachment }
}
