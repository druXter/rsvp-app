// app/admin/manual-rsvp-panel.tsx
import { addManualRsvp } from './manual-rsvp-actions'
import { SettingsError, SettingsForm } from './settings-form'
import { formatEuro } from '../lib/payment-state'
import { formatMaybeTime, defaultMaybeReminder, maybeAvailable } from '../lib/maybe'
import { Disclosure, SubmitButton, hintClass, inputClass, labelClass } from '../ui/kit'

type PanelEvent = Parameters<typeof maybeAvailable>[0] & {
  id: string
  inviteOnly: boolean
  requireVerification: boolean
  series: { allowMaybe: boolean; requireVerification: boolean } | null
}

/**
 * Reiter „Gäste“: eine Antwort von Hand eintragen (app/admin/manual-rsvp-actions.ts) - Name, Zusage/Vielleicht/
 * Absage, E-Mail. Die Adresse ist nur mit Haken bestätigt, eine Mail geht nur mit Haken raus. Nicht im Einladungsmodus
 * (dort über Einladungen).
 */
export default function ManualRsvpPanel({ event, categories }: { event: PanelEvent; categories: { id: string; label: string; priceCents: number }[] }) {
  if (event.inviteOnly) return null
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const maybe = maybeAvailable(event)
  return (
    <Disclosure className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800" testId="manual-rsvp">
      <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">+ Gast eintragen</summary>
      <SettingsForm action={addManualRsvp} className="mt-4 space-y-4">
        <SettingsError />
        <input type="hidden" name="eventId" value={event.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="manual-name" className={labelClass}>Name</label>
            <input id="manual-name" name="name" required maxLength={100} className={inputClass} />
          </div>
          <div>
            <label htmlFor="manual-status" className={labelClass}>Antwort</label>
            <select id="manual-status" name="status" defaultValue="yes" className={inputClass}>
              <option value="yes">Zusage</option>
              {maybe && <option value="maybe">Vielleicht</option>}
              <option value="no">Absage</option>
            </select>
            {maybe && (
              <p className={hintClass}>
                „Vielleicht“ erinnert am {formatMaybeTime(defaultMaybeReminder(event))} (nur an eine bestätigte Adresse) und wird am Stichtag zur Absage.
              </p>
            )}
          </div>
        </div>
        {categories.length > 0 && (
          <div>
            <label htmlFor="manual-category" className={labelClass}>Ticketkategorie (bei Zusage)</label>
            <select id="manual-category" name="ticketCategoryId" className={inputClass}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label} ({formatEuro(c.priceCents)})</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="manual-email" className={labelClass}>E-Mail (optional)</label>
          <input id="manual-email" type="email" name="email" maxLength={255} className={inputClass} />
          <label className="mt-2 flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" name="emailVerified" className="mt-0.5 h-4 w-4 accent-blue-600" />
            <span>Adresse ist bestätigt (z. B. weil der Gast sie dir selbst geschrieben hat)</span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" name="sendMail" className="mt-0.5 h-4 w-4 accent-blue-600" />
            <span>Mail an den Gast schicken</span>
          </label>
          <p className={hintClass}>
            Ohne Haken geht keine Mail raus. Mit Haken bekommt eine Zusage die Bestätigung mit Kalenderdatei, Einlass-QR-Code
            und Zahlungsdaten (je nach Termin){requireVerification ? ' - ist die Adresse nicht bestätigt, zuerst die Bitte um Bestätigung, die Bestätigung folgt nach dem Klick' : ''}.
            Ein Vielleicht mit unbestätigter Adresse bekommt die Bitte um Bestätigung (sonst keine Erinnerung), eine Absage keine Mail.
            {requireVerification ? ' Ohne bestätigte Adresse zählt eine Zusage erst nach der Bestätigung - die Mail dafür geht auch später unter „Details“ mit „erneut senden“.' : ''}
          </p>
        </div>
        <p className={hintClass}>Eine Zusage bekommt einen festen Platz, auch über die Kapazität hinaus (wie „Zulassen“). Begleitungen, Menü und weitere Angaben danach über „Bearbeiten“.</p>
        <SubmitButton inline>Eintragen</SubmitButton>
      </SettingsForm>
    </Disclosure>
  )
}
