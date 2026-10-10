// app/lib/payment-import.ts
//
// Vorschau des Kontoauszug-Imports (app/admin/zahlungen/[eventId]): verbindet die Treffer aus
// app/lib/bank-import.ts mit den Zusagen eines Termins. Gespeichert wird hier nichts - erst die Bestätigung
// (confirmBankImport in app/admin/actions.ts) markiert die ausgewählten Zusagen als bezahlt.
import { prisma } from './prisma'
import { matchStatement } from './bank-import'
import { formatEuro, paymentDue, paymentState, PAYMENT_STATE_LABEL } from './payment-state'

export type ImportPreviewRow = {
  rsvpId: string
  name: string
  categoryLabel: string | null
  amount: string
  reference: string
  stateLabel: string
  occurrences: number
  amountMatches: boolean
  amountsFound: string[]
  /** Nur offene Zahlungen lassen sich markieren */
  selectable: boolean
}

export type ImportPreview = {
  records: number
  rows: ImportPreviewRow[]
  unknownCodes: { code: string; suggestion: string | null }[]
  openCount: number
}

export async function buildImportPreview(eventId: string, text: string): Promise<ImportPreview> {
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId, paymentReference: { not: null }, amountCents: { gt: 0 } },
    include: { participant: { select: { name: true } }, ticketCategory: { select: { label: true } } },
    orderBy: { createdAt: 'asc' }
  })
  const candidates = rsvps.map(r => ({ rsvpId: r.id, reference: r.paymentReference!, amountCents: r.amountCents! }))
  // Präfix aus den vorhandenen Verwendungszwecken (nicht aus dem Slug: der kann sich seitdem geändert haben)
  const prefix = rsvps[0]?.paymentReference!.split('-')[0] ?? ''
  const result = matchStatement(text, candidates, prefix)
  const byId = new Map(rsvps.map(r => [r.id, r]))
  return {
    records: result.records,
    rows: result.matches.map(m => {
      const r = byId.get(m.rsvpId)!
      return {
        rsvpId: r.id,
        name: r.participant.name,
        categoryLabel: r.ticketCategory?.label ?? null,
        amount: formatEuro(r.amountCents!),
        reference: m.reference,
        stateLabel: paymentState(r) === 'none' ? 'nichts fällig (Warteliste oder Absage)' : PAYMENT_STATE_LABEL[paymentState(r)],
        occurrences: m.occurrences,
        amountMatches: m.amountMatches,
        amountsFound: m.amountsFound.map(formatEuro),
        selectable: paymentDue(r)
      }
    }),
    unknownCodes: result.unknownCodes,
    openCount: rsvps.filter(r => paymentDue(r)).length
  }
}
