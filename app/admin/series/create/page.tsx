// app/admin/series/create/page.tsx
import { redirect } from 'next/navigation'
import { createEventSeries } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import ThemeSection, { themeClasses } from '../../../ui/theme-section'
import AdminShell from '../../admin-shell'
import { PageHeader, inputClass, SubmitButton } from '../../../ui/kit'

export default async function CreateEventSeriesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role === 'MODERATOR') redirect('/admin')

  return (
    <AdminShell user={user} width="narrow">
      <PageHeader title="Neue Reihe" back={{ href: '/admin', label: 'Alle Events' }} subtitle="Für regelmäßige Termine mit einem gemeinsamen Gäste-Profil (z.B. Stammtisch, Training)." />
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 space-y-6 text-gray-900 dark:text-gray-100">

        <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-700">
          Eine Reihe bündelt mehrere Termine unter einer gemeinsamen Übersichtsseite. Kontaktdaten,
          Essenswunsch und Allergien werden dabei nur einmal abgefragt und für alle Termine der Reihe
          übernommen - Zusage, Warteliste und restliche Angaben beantwortet jeder Gast pro Termin einzeln.
        </p>

        <form action={createEventSeries} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">Titel der Reihe</label>
            <input id="title" type="text" name="title" required className={inputClass} placeholder="z.B. Stammtisch 2026" />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input id="slug" type="text" name="slug" required className={inputClass} placeholder="z.B. stammtisch" />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Die Reihe ist dann unter domain.de/reihe/slug erreichbar.</p>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1">Beschreibung</label>
            <textarea id="description" name="description" rows={3} className={inputClass} placeholder="Kurze Beschreibung der Reihe..."></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Welche Profil-Felder sollen EINMALIG für die ganze Reihe abgefragt werden?</h3>

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
              <label htmlFor="eventPin" className={`block text-sm font-medium mb-1 ${themeClasses('indigo').heading}`}>Reihen-PIN / Passwort (Optional)</label>
              <input id="eventPin" type="text" name="eventPin" className={`w-full border ${themeClasses('indigo').border} p-2 rounded outline-none ${themeClasses('indigo').borderFocus}`} placeholder="z.B. Sommer26 (leer lassen für öffentliche Reihe)" />
              <p className={`text-xs ${themeClasses('indigo').text} mt-1`}>Gäste müssen diesen Code eingeben, bevor sie die Reihe oder einen ihrer Termine sehen können.</p>
            </div>
          </ThemeSection>

          <ThemeSection color="violet" title="Nur registrierte Teilnehmer" description="Nur Gäste mit eingeloggtem Teilnehmendenkonto (/mein-konto) dürfen an Terminen dieser Reihe teilnehmen - anonyme Anmeldungen sind dann nicht mehr möglich. Gilt für alle Termine der Reihe und kann später NICHT mehr geändert werden, deshalb jetzt bewusst entscheiden.">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="requireGuestUser" className={`w-4 h-4 ${themeClasses('violet').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('violet').heading}`}>Nur registrierte Teilnehmer zulassen</span>
            </label>
          </ThemeSection>

          <SubmitButton>Reihe speichern</SubmitButton>
        </form>

      </div>
    </AdminShell>
  )
}
