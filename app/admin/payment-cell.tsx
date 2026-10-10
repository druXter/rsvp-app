// app/admin/payment-cell.tsx
'use client'

import { cancelUnpaidRsvp, setPaymentStatus } from './actions'
import { PAYMENT_STATE_LABEL, type PaymentState } from '../lib/payment-state'

const BADGE: Record<PaymentState, string> = {
  none: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  open: 'bg-pink-100 dark:bg-pink-950 text-pink-800 dark:text-pink-200',
  overdue: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200',
  paid: 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200',
  'refund-open': 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200',
  refunded: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
}

const BUTTON = 'text-[10px] px-1.5 py-0.5 rounded border border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 hover:bg-pink-100 dark:hover:bg-pink-900 transition'

function StatusButton({ rsvpId, action, children, title }: { rsvpId: string; action: string; children: React.ReactNode; title?: string }) {
  return (
    <form action={setPaymentStatus}>
      <input type="hidden" name="rsvpId" value={rsvpId} />
      <input type="hidden" name="paymentAction" value={action} />
      <button type="submit" className={BUTTON} title={title}>{children}</button>
    </form>
  )
}

/**
 * Spalte "Ticket / Zahlung" der Gästeliste (EventRsvpCard): Kategorie, Betrag, Verwendungszweck, Status und
 * die passenden Aktionen (setPaymentStatus, cancelUnpaidRsvp in app/admin/actions.ts - die Aktionen prüfen
 * Rechte und Zustand selbst). Farbe pink = Tickets und Bezahlung.
 */
export default function PaymentCell({ rsvpId, state, categoryLabel, amount, reference, paidAt, method, dueAt }: {
  rsvpId: string
  state: PaymentState
  categoryLabel: string | null
  amount: string | null
  reference: string | null
  paidAt: string | null
  method: string | null
  dueAt: string | null
}) {
  return (
    <div className="flex flex-col items-start gap-1" data-testid="payment-cell">
      {categoryLabel && <span className="font-medium text-gray-800 dark:text-gray-200">{categoryLabel}</span>}
      {amount && <span className="text-gray-600 dark:text-gray-400">{amount}{reference && <span className="font-mono text-[10px] ml-1 select-all">{reference}</span>}</span>}
      {state !== 'none' && (
        <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full ${BADGE[state]}`} title={state === 'paid' && paidAt ? `Bezahlt am ${paidAt}${method === 'CASH' ? ' (bar)' : ' (Überweisung)'}` : dueAt ? `Zahlbar bis ${dueAt}` : undefined}>
          {PAYMENT_STATE_LABEL[state]}{state === 'paid' && method === 'CASH' ? ' (bar)' : ''}{(state === 'open' || state === 'overdue') && dueAt ? ` bis ${dueAt}` : ''}
        </span>
      )}
      <div className="flex flex-wrap gap-1">
        {(state === 'open' || state === 'overdue') && (
          <>
            <StatusButton rsvpId={rsvpId} action="paid-transfer" title="Überweisung ist eingegangen - der Gast bekommt eine Bestätigung per Mail">✅ Bezahlt</StatusButton>
            <StatusButton rsvpId={rsvpId} action="paid-cash" title="Bar kassiert (keine Mail)">💶 Bar</StatusButton>
          </>
        )}
        {state === 'overdue' && (
          <form action={cancelUnpaidRsvp}>
            <input type="hidden" name="rsvpId" value={rsvpId} />
            <button
              type="submit"
              onClick={(e) => { if (!confirm('Zusage wegen abgelaufener Zahlfrist stornieren? Der Gast bekommt eine Mail, Wartende rücken nach.')) e.preventDefault() }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 transition"
            >
              Stornieren
            </button>
          </form>
        )}
        {state === 'paid' && <StatusButton rsvpId={rsvpId} action="unpaid" title="Als unbezahlt markieren (z. B. versehentlich markiert)">↩️ Zurücksetzen</StatusButton>}
        {state === 'refund-open' && <StatusButton rsvpId={rsvpId} action="refunded" title="Betrag zurücküberwiesen">✅ Erstattet</StatusButton>}
        {state === 'refunded' && <StatusButton rsvpId={rsvpId} action="refund-undo">↩️ Rückgängig</StatusButton>}
      </div>
    </div>
  )
}
