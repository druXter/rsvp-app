// app/admin/create/page.tsx
import { redirect } from 'next/navigation'
import { createEvent } from '../actions'
import { getCurrentUser } from '../../lib/auth'
import { EVENT_PRESETS } from '../../lib/event-presets'
import AdminShell from '../admin-shell'
import SubmitButton from '../../ui/submit-button'
import { Card, PageHeader, hintClass, inputClass, labelClass } from '../../ui/kit'

/**
 * Neues Event (docs/KONZEPT-OBERFLAECHE.md): nur Grunddaten und die Art des Events. Die Art setzt passende
 * Grundeinstellungen (app/lib/event-presets.ts); alles Weitere (Formular, Menü, Tickets, Verknüpfungen ...) stellt
 * ihr danach auf der Event-Seite ein, wohin createEvent weiterleitet.
 */
export default async function CreateEventPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role === 'MODERATOR') redirect('/admin')

  return (
    <AdminShell user={user} width="narrow">
      <PageHeader title="Neues Event" back={{ href: '/admin', label: 'Alle Events' }} subtitle="Erst das Wichtigste - alles Weitere stellt ihr danach in Ruhe ein." />
      <form action={createEvent} className="space-y-4">
        <Card className="space-y-4">
          <div>
            <label htmlFor="title" className={labelClass}>Titel</label>
            <input id="title" name="title" required maxLength={200} className={inputClass} placeholder="z.B. Sommerfest 2027" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="date" className={labelClass}>Datum und Uhrzeit</label>
              <input id="date" type="datetime-local" name="date" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="duration" className={labelClass}>Dauer in Stunden</label>
              <input id="duration" type="number" name="duration" min="1" max="72" defaultValue={4} required className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="location" className={labelClass}>Ort (optional)</label>
            <input id="location" name="location" className={inputClass} />
          </div>
          <div>
            <label htmlFor="description" className={labelClass}>Beschreibung / Einladungstext (optional)</label>
            <textarea id="description" name="description" rows={3} className={inputClass} />
          </div>
        </Card>

        <Card>
          <fieldset>
            <legend className="font-semibold text-gray-900 dark:text-gray-100">Was für ein Event?</legend>
            <p className={hintClass}>Setzt passende Grundeinstellungen - alles lässt sich später ändern.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(EVENT_PRESETS).map(([key, preset], i) => (
                <label key={key} htmlFor={`preset-${key}`} aria-label={preset.label} className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 hover:border-blue-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 dark:border-gray-700 dark:has-[:checked]:bg-blue-950">
                  <input id={`preset-${key}`} type="radio" name="preset" value={key} defaultChecked={i === 0} className="mt-1 accent-blue-600" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{preset.label}</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400">{preset.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <details className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">Weitere Optionen (Kapazität, Adresse, Konto-Pflicht)</summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="maxCapacity" className={labelClass}>Kapazität (optional)</label>
                <input id="maxCapacity" type="number" name="maxCapacity" min="1" className={inputClass} placeholder="unbegrenzt" />
              </div>
              <div>
                <label htmlFor="slug" className={labelClass}>Adresse (URL-Wort, optional)</label>
                <input id="slug" name="slug" className={`${inputClass} font-mono`} placeholder="wird aus dem Titel gebildet" />
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" name="requireGuestUser" className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span className="text-sm text-gray-800 dark:text-gray-200">
                Nur mit Teilnehmendenkonto
                <span className="block text-xs text-gray-500 dark:text-gray-400">Antworten nur nach Login unter „Mein Konto“. Lässt sich später nicht mehr ändern und nicht mit Einladungen kombinieren.</span>
              </span>
            </label>
          </div>
        </details>

        <SubmitButton>Event anlegen</SubmitButton>
      </form>
    </AdminShell>
  )
}
