// app/admin/series/[id]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { addTerminToSeries } from '../../actions'
import EventRsvpCard from '../../event-rsvp-card'
import DeleteSeriesButton from '../../delete-series-button'
import { getCurrentUser } from '../../../lib/auth'
import { isOwnerOrAdmin } from '../../../lib/permissions'

const prisma = new PrismaClient()

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { id } = await params
  const series = await prisma.eventSeries.findUnique({
    where: { id },
    include: {
      events: {
        include: {
          rsvps: {
            include: { participant: true },
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { date: 'asc' }
      },
      sharedWith: { where: { userId: user.id } }
    }
  })

  const isOwner = !!series && isOwnerOrAdmin(user, series.ownerId)
  const isModerator = !!series && !isOwner && series.sharedWith.length > 0

  if (!series || (!isOwner && !isModerator)) {
    return <div className="p-8">Reihe nicht gefunden.</div>
  }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="flex justify-between items-start border-b pb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{series.title}</h1>
              <p className="text-sm text-gray-500">Reihen-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/reihe/{series.slug}</span></p>
              {series.description && <p className="text-sm text-gray-600 mt-2">{series.description}</p>}
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <Link href="/admin" className="px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition">
                ← Dashboard
              </Link>
              {isOwner && (
                <Link href={`/admin/series/${series.id}/edit`} className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded hover:bg-blue-200 transition">
                  ✏️ Reihe bearbeiten
                </Link>
              )}
              {isOwner && <DeleteSeriesButton seriesId={series.id} />}
            </div>
          </div>

          {isOwner && (
          <div className="pt-2">
            <details className="group">
              <summary className="cursor-pointer text-sm font-bold text-purple-600 hover:text-purple-800 transition list-none">
                ＋ Termin zu dieser Reihe hinzufügen
              </summary>
              <form action={addTerminToSeries} className="mt-4 space-y-4 bg-purple-50 p-4 rounded-md border border-purple-200">
                <input type="hidden" name="seriesId" value={series.id} />

                <div>
                  <label className="block text-sm font-medium mb-1">Termin-Titel</label>
                  <input type="text" name="title" required className="w-full border border-gray-300 p-2 rounded" placeholder={`z.B. ${series.title} - Januar`} />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
                  <input type="text" name="slug" required className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. januar" />
                  <p className="text-xs text-gray-500 mt-1">Erreichbar unter domain.de/reihe/{series.slug}/slug</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Datum & Uhrzeit</label>
                  <input type="datetime-local" name="date" required className="w-full border border-gray-300 p-2 rounded" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Dauer (in Stunden)</label>
                  <input type="number" name="duration" min="1" max="72" defaultValue={4} required className="w-full border border-gray-300 p-2 rounded" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Ort</label>
                  <input type="text" name="location" className="w-full border border-gray-300 p-2 rounded" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Maximale Teilnehmerzahl (optional)</label>
                  <input type="number" name="maxCapacity" min="1" className="w-full border border-gray-300 p-2 rounded" placeholder="leer lassen für unbegrenzt" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Beschreibung / Einladungstext</label>
                  <textarea name="description" rows={3} className="w-full border border-gray-300 p-2 rounded"></textarea>
                </div>

                <div className="space-y-2 pt-2 border-t border-purple-200">
                  <h4 className="font-bold text-gray-900 text-sm">Für DIESEN Termin einzeln abgefragt:</h4>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="askAlcohol" className="w-4 h-4" />
                    <span>Alkohol-Präferenz abfragen (Ja/Nein)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="askPlusOne" className="w-4 h-4" />
                    <span>Begleitperson (+1) abfragen</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="askBringingItem" className="w-4 h-4" />
                    <span>Mitbringsel (Essen/Trinken) abfragen</span>
                  </label>
                </div>

                <div className="space-y-2 pt-2 border-t border-purple-200">
                  <h4 className="font-bold text-gray-900 text-sm">Freie Zusatzfragen für DIESEN Termin (optional, max. 3):</h4>
                  <input type="text" name="customQuestion1" className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Welchen Song wünschst du dir vom DJ?" />
                  <input type="text" name="customQuestion2" className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale zweite Frage" />
                  <input type="text" name="customQuestion3" className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale dritte Frage" />
                </div>

                <div className="space-y-2 pt-2 border-t border-purple-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="autoReminder" className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium">Automatische Erinnerung aktivieren</span>
                  </label>
                  <div>
                    <label className="block text-sm font-medium mb-1">Wie viele Tage vor dem Termin?</label>
                    <input type="number" name="reminderDays" min="1" max="30" defaultValue={7} className="w-full border border-gray-300 p-2 rounded" />
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-purple-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="enableCheckin" className="w-4 h-4 text-teal-600" />
                    <span className="text-sm font-medium">QR-Code Check-in für diesen Termin aktivieren</span>
                  </label>
                </div>

                <button type="submit" className="w-full bg-purple-600 text-white font-bold py-2 px-4 rounded hover:bg-purple-700 transition">
                  Termin speichern
                </button>
              </form>
            </details>
          </div>
          )}
        </div>

        {series.events.length === 0 ? (
          <p className="text-center text-gray-500 italic bg-white p-6 rounded-lg shadow">Diese Reihe hat noch keine Termine.</p>
        ) : (
          series.events.map(event => (
            <EventRsvpCard key={event.id} event={event} requireVerification={series.requireVerification} access={isOwner ? 'owner' : 'moderator'} />
          ))
        )}

      </div>
    </main>
  )
}
