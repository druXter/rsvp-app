// app/admin/edit/[id]/page.tsx
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { updateEvent } from '../../actions'

const prisma = new PrismaClient()

/**
 * Admin-Seite zum Bearbeiten eines bestehenden Events.
 * Lädt die aktuellen Daten aus der Datenbank und stellt sie als Standardwerte im Formular bereit.
 */
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  // Sicherheits-Check
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')

  if (!session || session.value !== 'true') {
    redirect('/admin/login')
  }

  // Event anhand der übergebenen ID suchen
  const { id } = await params
  const event = await prisma.event.findUnique({ where: { id } })

  if (!event) {
    return <div className="p-8">Event nicht gefunden.</div>
  }

  // Das HTML-Feld 'datetime-local' erfordert ein sehr spezifisches Format (YYYY-MM-DDThh:mm).
  // Hier wandeln wir den ISO-String der Datenbank entsprechend um.
  const d = new Date(event.date)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const formattedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

  // Die gespeicherte JSON-Konfiguration entschlüsseln. 
  // Fallback-Werte werden gesetzt, falls das Event erstellt wurde, bevor bestimmte Felder existierten.
  const config = event.formConfig ? JSON.parse(event.formConfig) : { askEmail: false, askPhone: false, askDiet: true, askAlcohol: true }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Event bearbeiten</h1>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <form action={updateEvent} className="space-y-4">
          {/* Unsichtbares Feld, um die Event-ID sicher an den Server zu übergeben */}
          <input type="hidden" name="eventId" value={event.id} />

          <div>
            <label className="block text-sm font-medium mb-1">Event-Titel</label>
            <input type="text" name="title" defaultValue={event.title} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input type="text" name="slug" defaultValue={event.slug} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Datum & Uhrzeit</label>
            <input type="datetime-local" name="date" defaultValue={formattedDate} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Dauer (in Stunden)</label>
            <input type="number" name="duration" min="1" max="72" defaultValue={event.duration} required className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Ort</label>
            <input type="text" name="location" defaultValue={event.location || ''} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung / Einladungstext</label>
            <textarea name="description" defaultValue={event.description || ''} rows={4} className="w-full border border-gray-300 p-2 rounded"></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Welche Felder sollen im Formular abgefragt werden?</h3>
            
            {/* Standardwerte der Checkboxen basierend auf der geladenen Konfiguration (config) setzen */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askEmail" defaultChecked={config.askEmail} className="w-4 h-4" />
              <span>E-Mail Adresse abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPhone" defaultChecked={config.askPhone} className="w-4 h-4" />
              <span>Handynummer abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askDiet" defaultChecked={config.askDiet} className="w-4 h-4" />
              <span>Essenswünsche abfragen (Veggie/Vegan/Allergien)</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAlcohol" defaultChecked={config.askAlcohol} className="w-4 h-4" />
              <span>Alkohol-Präferenz abfragen (Ja/Nein)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPlusOne" defaultChecked={config.askPlusOne} className="w-4 h-4" />
              <span>Begleitperson (+1) abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askBringingItem" defaultChecked={config.askBringingItem} className="w-4 h-4" />
              <span>Mitbringsel (Essen/Trinken) abfragen</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAllergies" defaultChecked={config.askAllergies} className="w-4 h-4" />
              <span>Allergien abfragen</span>
            </label>
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Änderungen speichern
          </button>
        </form>
      </div>
    </main>
  )
}