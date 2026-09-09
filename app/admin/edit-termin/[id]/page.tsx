// app/admin/edit-termin/[id]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { updateSeriesTermin } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import { isOwnerOrAdmin } from '../../../lib/permissions'
import SubmitButton from '../../../ui/submit-button'
import ThemeSection, { themeClasses } from '../../../ui/theme-section'
import NotifyGuestsToggle from '../../notify-guests-toggle'

const prisma = new PrismaClient()

export default async function EditSeriesTerminPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { id } = await params
  const event = await prisma.event.findUnique({ where: { id }, include: { series: true } })

  if (!event || !event.series || !isOwnerOrAdmin(user, event.ownerId)) {
    return notFound()
  }

  const d = new Date(event.date)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const formattedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

  const config = event.formConfig ? JSON.parse(event.formConfig) : { askAlcohol: false, askPlusOne: false, askBringingItem: false }

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">

        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Termin bearbeiten</h1>
          <Link href={`/admin/series/${event.series.id}`} className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <p className="text-sm text-gray-600 bg-purple-50 p-3 rounded border border-purple-200">
          Teil der Reihe <strong>{event.series.title}</strong>. Profil-Felder, Verifizierung, Gästeliste und PIN werden
          zentral <Link href={`/admin/series/${event.series.id}/edit`} className="underline">für die ganze Reihe</Link> verwaltet.
        </p>

        <form id="edit-termin-form" action={updateSeriesTermin} className="space-y-4">
          <input type="hidden" name="eventId" value={event.id} />

          <div>
            <label className="block text-sm font-medium mb-1">Termin-Titel</label>
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
            <label className="block text-sm font-medium mb-1">Maximale Teilnehmerzahl (optional)</label>
            <input type="number" name="maxCapacity" min="1" defaultValue={event.maxCapacity || ''} className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. 50 (leer lassen für unbegrenzt)" />
            <p className="text-xs text-gray-500 mt-1">Gäste landen automatisch auf der Warteliste, wenn dieses Limit erreicht ist.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung / Einladungstext</label>
            <textarea name="description" defaultValue={event.description || ''} rows={4} className="w-full border border-gray-300 p-2 rounded"></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Für DIESEN Termin einzeln abgefragt</h3>

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
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="font-bold text-gray-900">Freie Zusatzfragen für diesen Termin (optional, max. 3)</h3>
            <input type="text" name="customQuestion1" defaultValue={config.customQuestions?.[0] || ''} className="w-full border border-gray-300 p-2 rounded" placeholder="z.B. Welchen Song wünschst du dir vom DJ?" />
            <input type="text" name="customQuestion2" defaultValue={config.customQuestions?.[1] || ''} className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale zweite Frage" />
            <input type="text" name="customQuestion3" defaultValue={config.customQuestions?.[2] || ''} className="w-full border border-gray-300 p-2 rounded" placeholder="Optionale dritte Frage" />
          </div>

          <ThemeSection color="sky" title="Automatische E-Mail Erinnerung">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="autoReminder" defaultChecked={event.autoReminder} className={`w-4 h-4 ${themeClasses('sky').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('sky').heading}`}>Automatische Erinnerung aktivieren</span>
            </label>

            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('sky').heading}`}>Wie viele Tage vor dem Termin?</label>
              <input type="number" name="reminderDays" min="1" max="30" defaultValue={event.reminderDays} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </ThemeSection>

          <ThemeSection color="teal" title="QR-Code Einlasskontrolle">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="enableCheckin" defaultChecked={event.enableCheckin} className={`w-4 h-4 ${themeClasses('teal').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('teal').heading}`}>QR-Code Check-in für diesen Termin aktivieren</span>
            </label>
          </ThemeSection>

          <ThemeSection color="cyan" title="Externe Abstimmung" description="Verlinkt z.B. auf eine Restaurant-Wahl im separaten Abstimmungstool. Ein eingeloggter, verifizierter Nutzer wird dabei automatisch für diese Abstimmung erkannt (falls die Abstimmung das nutzt) - alle anderen können trotzdem ganz normal darüber abstimmen.">
            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('cyan').heading}`}>Link zur Abstimmung (Optional)</label>
              <input type="url" name="pollUrl" defaultValue={event.pollUrl || ''} className={`w-full border ${themeClasses('cyan').border} p-2 rounded outline-none ${themeClasses('cyan').borderFocus}`} placeholder="https://abstimmung.example.de/xyz" />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${themeClasses('cyan').heading}`}>Beschriftung des Buttons (Optional)</label>
              <input type="text" name="pollLabel" defaultValue={event.pollLabel || ''} className={`w-full border ${themeClasses('cyan').border} p-2 rounded outline-none ${themeClasses('cyan').borderFocus}`} placeholder="z.B. Restaurant für diesen Termin wählen" />
            </div>
          </ThemeSection>

          <NotifyGuestsToggle
            formId="edit-termin-form"
            original={{
              title: event.title,
              date: formattedDate,
              duration: String(event.duration),
              location: event.location || '',
              description: event.description || ''
            }}
          />

          <SubmitButton>Änderungen speichern</SubmitButton>
        </form>
      </div>
    </main>
  )
}
