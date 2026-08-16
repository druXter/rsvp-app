// app/admin/create/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createEvent } from '../actions'

export default async function CreateEventPage() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')

  if (!session || session.value !== 'true') {
    redirect('/admin/login')
  }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Neues Event anlegen</h1>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition">
            Zurück
          </Link>
        </div>

        <form action={createEvent} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Event-Titel</label>
            <input type="text" name="title" required className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Sommerfest 2026" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input type="text" name="slug" required className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. sommerfest" />
            <p className="text-xs text-gray-500 mt-1">Das Event ist dann unter domain.de/slug erreichbar.</p>
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
            <input type="text" name="location" className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Hauptcampus / Aula" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung / Einladungstext</label>
            <textarea name="description" rows={4} className="w-full border border-gray-300 p-2 rounded" placeholder="Wir laden euch herzlich ein..."></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Welche Felder sollen im Formular abgefragt werden?</h3>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askEmail" className="w-4 h-4" />
              <span>E-Mail Adresse abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPhone" className="w-4 h-4" />
              <span>Handynummer abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askDiet" className="w-4 h-4" />
              <span>Essenswünsche abfragen (Veggie/Vegan)</span>
            </label>
            
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
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAllergies" className="w-4 h-4" />
              <span>Allergien abfragen</span>
            </label>
          </div>

          {/* Einstellungen für Uptime Kuma Cronjob */}
          <div className="space-y-3 pt-4 border-t border-gray-200 bg-blue-50 p-4 rounded-md">
            <h3 className="font-bold text-blue-900">Automatische E-Mail Erinnerung</h3>
            <p className="text-xs text-blue-700 mb-2">Erfordert, dass Gäste ihre E-Mail angeben (siehe oben).</p>
            
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="autoReminder" className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Automatische Erinnerung aktivieren</span>
            </label>
            
            <div>
              <label className="block text-sm font-medium mb-1 text-blue-900">Wie viele Tage vor dem Event?</label>
              <input type="number" name="reminderDays" min="1" max="30" defaultValue={7} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </div>

          <button type="submit" className="w-full bg-green-600 text-white font-bold py-2 px-4 rounded hover:bg-green-700 transition">
            Event speichern
          </button>
        </form>

      </div>
    </main>
  )
}