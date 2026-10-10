// app/admin/zahlungen/[eventId]/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import BankImportForm from './bank-import-form'

const prisma = new PrismaClient()

/**
 * Kontoauszug abgleichen (docs/KONZEPT-TICKETS.md): Datei der Bank hochladen, Vorschau prüfen, ausgewählte
 * Zusagen als bezahlt markieren. Für alle, die Zahlungen markieren dürfen (Owner, Admin, Moderator*innen).
 */
export default async function PaymentImportPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ markiert?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { eventId } = await params
  const { markiert } = await searchParams
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return notFound()

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6 text-gray-900 dark:text-gray-100">
        <div className="flex justify-between items-center border-b dark:border-gray-700 pb-4">
          <h1 className="text-2xl font-bold">Kontoauszug abgleichen</h1>
          <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">Zur Verwaltung</Link>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          <strong>{event.title}</strong>: Lade den Umsatz-Export deiner Bank hoch (CSV aus dem Online-Banking oder CAMT.053 als XML).
          rsvp-app sucht darin die Verwendungszwecke der Zusagen und schlägt vor, welche als bezahlt markiert werden.
          Die Datei wird nur für diesen Abgleich gelesen und nicht gespeichert.
        </p>
        {markiert !== undefined && (
          <p role="status" className="text-sm bg-green-50 text-green-800 p-3 rounded border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
            ✅ {markiert} Zahlung(en) als bezahlt markiert. Die Gäste bekommen eine Bestätigung per Mail.
          </p>
        )}
        <BankImportForm eventId={event.id} />
      </div>
    </main>
  )
}
