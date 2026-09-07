// app/admin/series/create/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createEventSeries } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import SubmitButton from '../../../ui/submit-button'
import ThemeSection, { themeClasses } from '../../../ui/theme-section'

export default async function CreateEventSeriesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role === 'MODERATOR') redirect('/admin')

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">

        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Neue Veranstaltungsreihe anlegen</h1>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition">
            Zurück
          </Link>
        </div>

        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">
          Eine Reihe bündelt mehrere Termine unter einer gemeinsamen Übersichtsseite. Kontaktdaten,
          Essenswunsch und Allergien werden dabei nur einmal abgefragt und für alle Termine der Reihe
          übernommen - Zusage, Warteliste und restliche Angaben beantwortet jeder Gast pro Termin einzeln.
        </p>

        <form action={createEventSeries} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Titel der Reihe</label>
            <input type="text" name="title" required className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Stammtisch 2026" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input type="text" name="slug" required className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. stammtisch" />
            <p className="text-xs text-gray-500 mt-1">Die Reihe ist dann unter domain.de/reihe/slug erreichbar.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung</label>
            <textarea name="description" rows={3} className="w-full border border-gray-300 p-2 rounded" placeholder="Kurze Beschreibung der Reihe..."></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Welche Profil-Felder sollen EINMALIG für die ganze Reihe abgefragt werden?</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askEmail" className="w-4 h-4" />
              <span>E-Mail Adresse abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPhone" className="w-4 h-4" />
              <span>Handynummer abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askDiet" defaultChecked className="w-4 h-4" />
              <span>Essenswünsche abfragen (Veggie/Vegan)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAllergies" className="w-4 h-4" />
              <span>Allergien abfragen</span>
            </label>
          </div>

          <ThemeSection color="yellow" title="E-Mail-Verifizierung (Double-Opt-In)" description="Gäste müssen ihre Anmeldung per Klick in einer E-Mail bestätigen - gilt einmalig für die ganze Reihe. (Erfordert E-Mail-Abfrage oben).">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="requireVerification" className={`w-4 h-4 ${themeClasses('yellow').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('yellow').heading}`}>Verifizierung zwingend erforderlich</span>
            </label>
          </ThemeSection>

          <ThemeSection color="indigo" title="Gruppen- & Vereins-Features (gelten für alle Termine der Reihe)">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="isGuestListVisible" className={`w-4 h-4 ${themeClasses('indigo').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('indigo').heading}`}>Transparente Gästeliste (Zeigt Wer kommt & Mitbringsel)</span>
            </label>

            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('indigo').heading}`}>Reihen-PIN / Passwort (Optional)</label>
              <input type="text" name="eventPin" className={`w-full border ${themeClasses('indigo').border} p-2 rounded outline-none ${themeClasses('indigo').borderFocus}`} placeholder="z.B. Sommer26 (leer lassen für öffentliche Reihe)" />
              <p className={`text-xs ${themeClasses('indigo').text} mt-1`}>Gäste müssen diesen Code eingeben, bevor sie die Reihe oder einen ihrer Termine sehen können.</p>
            </div>
          </ThemeSection>

          <SubmitButton>Reihe speichern</SubmitButton>
        </form>

      </div>
    </main>
  )
}
