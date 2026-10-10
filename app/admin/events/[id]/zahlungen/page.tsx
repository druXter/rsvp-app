// app/admin/events/[id]/zahlungen/page.tsx
import { notFound } from 'next/navigation'
import { Card, Notice } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import BankImportForm from './bank-import-form'

/**
 * Reiter "Zahlungen": Kontoauszug abgleichen (docs/KONZEPT-TICKETS.md) - Datei der Bank hochladen, Vorschau prüfen,
 * ausgewählte Zusagen als bezahlt markieren. Für alle, die Zahlungen markieren dürfen (Owner, Admin,
 * Moderator*innen). Den Stand pro Gast zeigt der Reiter "Gäste" (Filter "Zahlung offen").
 */
export default async function PaymentImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ markiert?: string }> }) {
  const { id } = await params
  const { markiert } = await searchParams
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event } = loaded

  return (
    <div className="space-y-4">
      {markiert !== undefined && (
        <Notice tone="success" role="status">✅ {markiert} Zahlung(en) als bezahlt markiert. Die Gäste bekommen eine Bestätigung per Mail.</Notice>
      )}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Kontoauszug abgleichen</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600 dark:text-gray-400">
          Lade den Umsatz-Export eurer Bank hoch (CSV aus dem Online-Banking oder CAMT.053 als XML). rsvp-app sucht darin die
          Verwendungszwecke der Zusagen und schlägt vor, welche als bezahlt markiert werden. Die Datei wird nur für diesen
          Abgleich gelesen und nicht gespeichert. Einzelne Zahlungen markiert ihr im Reiter <a href={`/admin/events/${event.id}/gaeste?filter=zahlung-offen`} className="underline">Gäste</a>.
        </p>
        <BankImportForm eventId={event.id} />
      </Card>
    </div>
  )
}
