// app/admin/series/[id]/edit/page.tsx
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { updateEventSeries } from '../../../actions'

const prisma = new PrismaClient()

export default async function EditEventSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session || session.value !== 'true') redirect('/admin/login')

  const { id } = await params
  const series = await prisma.eventSeries.findUnique({ where: { id } })

  if (!series) {
    return <div className="p-8">Reihe nicht gefunden.</div>
  }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">

        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Reihe bearbeiten</h1>
          <Link href={`/admin/series/${series.id}`} className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <form action={updateEventSeries} className="space-y-4">
          <input type="hidden" name="seriesId" value={series.id} />

          <div>
            <label className="block text-sm font-medium mb-1">Titel der Reihe</label>
            <input type="text" name="title" defaultValue={series.title} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input type="text" name="slug" defaultValue={series.slug} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung</label>
            <textarea name="description" defaultValue={series.description || ''} rows={3} className="w-full border border-gray-300 p-2 rounded"></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Welche Profil-Felder sollen EINMALIG für die ganze Reihe abgefragt werden?</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askEmail" defaultChecked={series.askEmail} className="w-4 h-4" />
              <span>E-Mail Adresse abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPhone" defaultChecked={series.askPhone} className="w-4 h-4" />
              <span>Handynummer abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askDiet" defaultChecked={series.askDiet} className="w-4 h-4" />
              <span>Essenswünsche abfragen (Veggie/Vegan)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAllergies" defaultChecked={series.askAllergies} className="w-4 h-4" />
              <span>Allergien abfragen</span>
            </label>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200 bg-yellow-50 p-4 rounded-md">
            <h3 className="font-bold text-yellow-900">E-Mail-Verifizierung (Double-Opt-In)</h3>
            <p className="text-xs text-yellow-700 mb-2">Gilt einmalig für die ganze Reihe. (Erfordert E-Mail-Abfrage oben).</p>

            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="requireVerification" defaultChecked={series.requireVerification} className="w-4 h-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-900">Verifizierung zwingend erforderlich</span>
            </label>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200 bg-purple-50 p-4 rounded-md">
            <h3 className="font-bold text-purple-900">Gruppen- & Vereins-Features (gelten für alle Termine der Reihe)</h3>

            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="isGuestListVisible" defaultChecked={series.isGuestListVisible} className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-900">Transparente Gästeliste (Zeigt Wer kommt & Mitbringsel)</span>
            </label>

            <div>
              <label className="block text-sm font-medium text-purple-900 mb-1">Reihen-PIN / Passwort (Optional)</label>
              <input type="text" name="eventPin" defaultValue={series.eventPin || ''} className="w-full border border-purple-300 p-2 rounded outline-none focus:border-purple-500" placeholder="leer lassen für öffentliche Reihe" />
            </div>
          </div>

          <button type="submit" className="w-full bg-purple-600 text-white font-bold py-2 px-4 rounded hover:bg-purple-700 transition">
            Änderungen speichern
          </button>
        </form>
      </div>
    </main>
  )
}
