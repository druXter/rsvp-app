// app/admin/create/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createEvent } from '../actions'
import { getCurrentUser } from '../../lib/auth'
import SubmitButton from '../../ui/submit-button'
import ThemeSection, { themeClasses } from '../../ui/theme-section'

export default async function CreateEventPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role === 'MODERATOR') redirect('/admin')

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
            <label className="block text-sm font-medium mb-1">Maximale Teilnehmerzahl (optional)</label>
            <input type="number" name="maxCapacity" min="1" className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. 50 (leer lassen für unbegrenzt)" />
            <p className="text-xs text-gray-500 mt-1">Gäste landen automatisch auf der Warteliste, wenn dieses Limit erreicht ist.</p>
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

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Freie Zusatzfragen (optional, max. 3)</h3>
            <p className="text-xs text-gray-500 mb-2">Leer lassen, um keine zusätzliche Frage zu stellen. Wird nur bei Zusage abgefragt.</p>
            <input type="text" name="customQuestion1" className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Welchen Song wünschst du dir vom DJ?" />
            <input type="text" name="customQuestion2" className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale zweite Frage" />
            <input type="text" name="customQuestion3" className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale dritte Frage" />
          </div>

          {/* Einstellungen für Uptime Kuma Cronjob */}
          <ThemeSection color="sky" title="Automatische E-Mail Erinnerung" description="Erfordert, dass Gäste ihre E-Mail angeben (siehe oben).">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="autoReminder" className={`w-4 h-4 ${themeClasses('sky').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('sky').heading}`}>Automatische Erinnerung aktivieren</span>
            </label>

            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('sky').heading}`}>Wie viele Tage vor dem Event?</label>
              <input type="number" name="reminderDays" min="1" max="30" defaultValue={7} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </ThemeSection>

          <ThemeSection color="yellow" title="E-Mail-Verifizierung (Double-Opt-In)" description="Gäste müssen ihre Anmeldung per Klick in einer E-Mail bestätigen. (Erfordert E-Mail-Abfrage oben).">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="requireVerification" className={`w-4 h-4 ${themeClasses('yellow').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('yellow').heading}`}>Verifizierung zwingend erforderlich</span>
            </label>
          </ThemeSection>

          <ThemeSection color="teal" title="QR-Code Einlasskontrolle" description="Bestätigte Gäste erhalten einen persönlichen QR-Code (Mail & Erfolgsseite) zum Scannen am Einlass.">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="enableCheckin" className={`w-4 h-4 ${themeClasses('teal').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('teal').heading}`}>QR-Code Check-in aktivieren</span>
            </label>
          </ThemeSection>

          <ThemeSection color="indigo" title="Gruppen- & Vereins-Features">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="isGuestListVisible" className={`w-4 h-4 ${themeClasses('indigo').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('indigo').heading}`}>Transparente Gästeliste (Zeigt Wer kommt & Mitbringsel)</span>
            </label>

            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('indigo').heading}`}>Event-PIN / Passwort (Optional)</label>
              <input type="text" name="eventPin" className={`w-full border ${themeClasses('indigo').border} p-2 rounded outline-none ${themeClasses('indigo').borderFocus}`} placeholder="z.B. Sommer26 (leer lassen für öffentliches Event)" />
              <p className={`text-xs ${themeClasses('indigo').text} mt-1`}>Gäste müssen diesen Code eingeben, bevor sie das Formular oder die Gästeliste sehen können.</p>
            </div>
          </ThemeSection>

          <SubmitButton>Event speichern</SubmitButton>
        </form>

      </div>
    </main>
  )
}