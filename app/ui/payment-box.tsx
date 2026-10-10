// app/ui/payment-box.tsx
import type { PaymentInfo } from '../lib/payment'

/**
 * Zahlungsdaten einer Zusage für Gäste (docs/KONZEPT-TICKETS.md): offen = Betrag, Empfänger*in, IBAN,
 * Verwendungszweck, Frist und GiroCode zum Scannen in der Banking-App; bezahlt = "Bezahlt am …"; nach einer
 * Absage mit Zahlung der Hinweis zur Erstattung. Daten kommen fertig vom Server (paymentInfoOf).
 * Farbe pink = Tickets und Bezahlung (siehe CLAUDE.md "Farbschema").
 */
export default function PaymentBox({ payment }: { payment: PaymentInfo }) {
  const category = payment.categoryLabel ? ` (${payment.categoryLabel})` : ''
  if (payment.state === 'paid') {
    return (
      <div className="w-full mt-4 p-4 rounded-lg border border-pink-300 bg-pink-50 text-pink-900 dark:bg-pink-950 dark:border-pink-800 dark:text-pink-100 text-center" data-testid="payment-box">
        ✅ Bezahlt: <strong>{payment.amount}</strong>{category}{payment.paidAt ? ` am ${payment.paidAt}` : ''}{payment.method === 'CASH' ? ' (bar)' : ''}
      </div>
    )
  }
  if (payment.state === 'refund-open' || payment.state === 'refunded') {
    return (
      <div className="w-full mt-4 p-4 rounded-lg border border-pink-300 bg-pink-50 text-pink-900 dark:bg-pink-950 dark:border-pink-800 dark:text-pink-100 text-center" data-testid="payment-box">
        {payment.state === 'refunded'
          ? <>💶 Deine Zahlung über <strong>{payment.amount}</strong> wurde erstattet.</>
          : <>💶 Du hattest <strong>{payment.amount}</strong> bezahlt. Die Erstattung klärt die Veranstaltung mit dir.</>}
      </div>
    )
  }
  const t = payment.transfer
  return (
    <div className="w-full mt-4 p-4 rounded-lg border border-pink-300 bg-pink-50 text-pink-900 dark:bg-pink-950 dark:border-pink-800 dark:text-pink-100" data-testid="payment-box">
      <p className="font-bold mb-2">
        💶 {payment.state === 'overdue' ? 'Zahlung überfällig' : 'Bitte überweise den Ticketpreis'}: {payment.amount}{category}
      </p>
      {t ? (
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 w-full">
            <dt className="text-pink-700 dark:text-pink-300">Empfänger*in</dt><dd>{t.recipient}</dd>
            <dt className="text-pink-700 dark:text-pink-300">IBAN</dt><dd className="font-mono">{t.iban}</dd>
            {t.bic && <><dt className="text-pink-700 dark:text-pink-300">BIC</dt><dd className="font-mono">{t.bic}</dd></>}
            <dt className="text-pink-700 dark:text-pink-300">Verwendungszweck</dt><dd className="font-mono font-bold" data-testid="payment-reference">{t.reference}</dd>
            {t.dueAt && <><dt className="text-pink-700 dark:text-pink-300">Zahlbar bis</dt><dd>{t.dueAt}</dd></>}
          </dl>
          <figure className="shrink-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.giroCode} alt="GiroCode für die Überweisung" className="w-36 h-36 bg-white rounded" />
            <figcaption className="text-xs mt-1 text-pink-700 dark:text-pink-300">GiroCode: in der Banking-App scannen</figcaption>
          </figure>
        </div>
      ) : (
        <p className="text-sm">Die Zahlungsdaten bekommst du von der Veranstaltung.</p>
      )}
      <p className="text-xs mt-2 text-pink-700 dark:text-pink-300">Bitte gib den Verwendungszweck genau so an, damit wir deine Zahlung zuordnen können.</p>
    </div>
  )
}
