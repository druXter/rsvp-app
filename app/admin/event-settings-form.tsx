// app/admin/event-settings-form.tsx
import type { Prisma } from '@prisma/client'
import type { ReactNode } from 'react'
import { updateEvent, updateSeriesTermin } from './actions'
import { formatBringSlots } from '../lib/bring-list'
import { courseOptions } from '../lib/menu'
import { deadlineInputValue } from '../lib/rsvp-deadline'
import { allowedSeatingOrigin } from '../lib/seating'
import { allowedTimelineOrigin } from '../lib/timeline'
import { allowedShiftsOrigin, formatShiftTiers, parseStoredTiers } from '../lib/shift-helpers'
import { TOOL_LINKS, storedToolUrl } from '../lib/linked-tools-store'
import { allowedFeedbackOrigin, FEEDBACK_DELAY_OPTIONS } from '../lib/feedback-link'
import { SettingsSection, hintClass, inputClass, labelClass } from '../ui/kit'
import SubmitButton from '../ui/submit-button'
import { MenuFields } from './menu-settings-section'
import { SeatingPaymentToggle, TicketFields } from './ticket-settings-section'
import NotifyGuestsToggle from './notify-guests-toggle'
import { SettingsError, SettingsForm } from './settings-form'
import FieldRules, { RuleNote, type FieldRule } from './field-rules'

export const SETTINGS_INCLUDE = {
  series: true,
  toolLinks: TOOL_LINKS,
  bringSlots: { orderBy: { position: 'asc' as const } },
  ticketCategories: { orderBy: { position: 'asc' as const } },
  menuCourses: { orderBy: { position: 'asc' as const } },
  // Wie viele Zusagen den Feedback-Fragebogen schon bekommen haben (app/lib/feedback.ts)
  _count: { select: { rsvps: { where: { feedbackSentAt: { not: null } } } } }
} satisfies Prisma.EventInclude

type SettingsEvent = Prisma.EventGetPayload<{ include: typeof SETTINGS_INCLUDE }>

function Check({ name, label, hint, defaultChecked }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
      <span className="text-sm text-gray-800 dark:text-gray-200">{label}{hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}</span>
    </label>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

const onOff = (on: boolean, text: string) => (on ? text : null)

// Was sich ausschließt bzw. was was braucht - prüft der Server ebenso (app/admin/actions.ts)
const RULE_LABELS = {
  inviteOnly: '„Nur mit Einladung“', eventPin: 'einer PIN', requireVerification: 'E-Mail-Bestätigung',
  ticketCategories: 'Ticketkategorien', maxCompanions: 'Begleitungen', shiftsUrl: 'Helfer*innen aus Schichten'
}
const RULES: FieldRule[] = [
  { excludes: ['inviteOnly', 'eventPin'] },
  { excludes: ['inviteOnly', 'requireVerification'] },
  { excludes: ['inviteOnly', 'ticketCategories'] },
  { excludes: ['maxCompanions', 'ticketCategories'] },
  { excludes: ['inviteOnly', 'shiftsUrl'] },
  { requires: 'rsvpReminderDays', needs: 'rsvpDeadline', hint: 'braucht eine Antwortfrist (Grunddaten)' },
  { requires: 'paymentReminderDays', needs: 'paymentDueDays', hint: 'braucht eine Zahlfrist' },
  { requires: 'datePending', needs: 'pollUrl', hint: 'braucht einen Link auf eine Abstimmung' },
  { requires: 'trackPresence', needs: 'enableCheckin', hint: 'braucht den Einlass mit QR-Code' }
]
const summary = (parts: (string | null | false | undefined)[], empty = 'aus') => parts.filter(Boolean).join(' · ') || empty

/**
 * Einstellungen eines Termins (docs/KONZEPT-OBERFLAECHE.md): ein Formular in einklappbaren Abschnitten, jeder mit
 * Kurzstand, für Einzel-Events (updateEvent) und Termine einer Reihe (updateSeriesTermin - ohne die reihenweiten
 * Profil-, Zugangs- und Verifizierungs-Felder). Feldnamen wie bisher, damit die Server Actions unverändert lesen.
 * `open`: Abschnitt, der aufgeklappt startet (z.B. nach dem Anlegen "tickets").
 */
export default function EventSettingsForm({ event, open = 'grunddaten' }: { event: SettingsEvent; open?: string }) {
  const isTermin = !!event.seriesId
  const seatingOrigin = allowedSeatingOrigin()
  const timelineOrigin = allowedTimelineOrigin()
  const config = event.formConfig ? JSON.parse(event.formConfig) : {}
  const customQuestions: string[] = config.customQuestions || []
  const d = new Date(event.date)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const formattedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const seatingUrl = storedToolUrl(event.toolLinks, 'seating')
  const timelineUrl = storedToolUrl(event.toolLinks, 'timeline')
  const shiftsUrl = storedToolUrl(event.toolLinks, 'shifts')
  const shiftsOrigin = allowedShiftsOrigin()
  const feedbackOrigin = allowedFeedbackOrigin()
  const formId = 'event-settings-form'
  // Fest gesperrt: Konto-Pflicht wird beim Anlegen festgelegt, Termine einer Einladungs-Reihe haben keine Kategorien
  const fixed: Record<string, string> = {
    ...(event.requireGuestUser ? { inviteOnly: 'nur mit Teilnehmendenkonto (beim Anlegen festgelegt)' } : {}),
    ...(isTermin && event.inviteOnly ? { ticketCategories: 'die Reihe ist im Einladungsmodus', shiftsUrl: 'die Reihe ist im Einladungsmodus' } : {})
  }

  return (
    <SettingsForm id={formId} action={isTermin ? updateSeriesTermin : updateEvent} className="space-y-3">
      <input type="hidden" name="eventId" value={event.id} />
      <FieldRules formId={formId} labels={RULE_LABELS} rules={RULES} fixed={fixed} />

      <SettingsSection id="grunddaten" title="Grunddaten" open={open === 'grunddaten'} marker="blue"
        summary={`${d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}${event.location ? ` · ${event.location}` : ''}`}>
        <Field id="title" label={isTermin ? 'Titel des Termins' : 'Titel'}>
          <input id="title" name="title" defaultValue={event.title} required className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="date" label="Datum und Uhrzeit">
            <input id="date" type="datetime-local" name="date" defaultValue={formattedDate} required className={inputClass} />
          </Field>
          <Field id="duration" label="Dauer in Stunden">
            <input id="duration" type="number" name="duration" min="1" max="72" defaultValue={event.duration} required className={inputClass} />
          </Field>
          <Field id="location" label="Ort">
            <input id="location" name="location" defaultValue={event.location || ''} className={inputClass} />
          </Field>
          <Field id="slug" label="Adresse (URL-Wort)" hint={`Gäste öffnen ${isTermin ? `/reihe/${event.series!.slug}/` : '/'}${event.slug}`}>
            <input id="slug" name="slug" defaultValue={event.slug} required className={`${inputClass} font-mono`} />
          </Field>
          <Field id="maxCapacity" label="Kapazität (optional)" hint="Darüber hinaus kommt man auf die Warteliste. Gezählt werden Personen (mit Begleitungen, ohne Kleinkinder).">
            <input id="maxCapacity" type="number" name="maxCapacity" min="1" defaultValue={event.maxCapacity || ''} className={inputClass} placeholder="unbegrenzt" />
          </Field>
          <Field id="rsvpDeadline" label="Antwortfrist (optional)" hint="Danach können Gäste nichts mehr ändern, nur noch ihr.">
            <input id="rsvpDeadline" type="date" name="rsvpDeadline" defaultValue={deadlineInputValue(event.rsvpDeadline)} className={inputClass} />
          </Field>
        </div>
        <Field id="description" label="Beschreibung / Einladungstext" hint="Steht auf der Seite für Gäste über dem Formular.">
          <textarea id="description" name="description" defaultValue={event.description || ''} rows={4} className={inputClass} />
        </Field>
      </SettingsSection>

      <SettingsSection id="formular" title="Anmeldeformular" open={open === 'formular'} marker="gray"
        summary={summary([
          !isTermin && onOff(config.askEmail, 'E-Mail'), !isTermin && onOff(config.askPhone, 'Handy'), !isTermin && onOff(config.askDiet, 'Essen'),
          !isTermin && onOff(config.askAllergies, 'Allergien'), onOff(config.askAlcohol, 'Alkohol'), onOff(config.askBringingItem, 'Mitbringsel'),
          event.maxCompanions > 0 && `bis ${event.maxCompanions} Begleitung${event.maxCompanions === 1 ? '' : 'en'}`, customQuestions.length > 0 && `${customQuestions.length} Zusatzfrage(n)`
        ], 'nur Name und Zu-/Absage')}
        description={isTermin ? 'E-Mail, Handy, Essen und Allergien fragt die Reihe einmal für alle Termine ab (Einstellungen der Reihe).' : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          {!isTermin && <Check name="askEmail" label="E-Mail-Adresse" defaultChecked={config.askEmail} />}
          {!isTermin && <Check name="askPhone" label="Handynummer" defaultChecked={config.askPhone} />}
          {!isTermin && <Check name="askDiet" label="Essenswunsch (alles, vegetarisch, vegan)" defaultChecked={config.askDiet} />}
          {!isTermin && <Check name="askAllergies" label="Allergien und Unverträglichkeiten" defaultChecked={config.askAllergies} />}
          <Check name="askAlcohol" label="Alkohol ja/nein" defaultChecked={config.askAlcohol} />
          <Check name="askBringingItem" label="Mitbringsel als Freitext" defaultChecked={config.askBringingItem} />
        </div>
        <Field id="maxCompanions" label="Begleitungen pro Anmeldung" hint="0 = keine. Jede Begleitung mit Name, Altersgruppe und den Angaben oben. Nicht zusammen mit Ticketkategorien.">
          <input id="maxCompanions" type="number" name="maxCompanions" min={0} max={20} defaultValue={event.maxCompanions} className={`${inputClass} sm:w-32`} />
          <RuleNote name="maxCompanions" />
        </Field>
        <div className="space-y-2">
          <p className={labelClass}>Eigene Zusatzfragen (optional, bis zu 3)</p>
          {[0, 1, 2].map(i => (
            <input key={i} name={`customQuestion${i + 1}`} defaultValue={customQuestions[i] || ''} aria-label={`Zusatzfrage ${i + 1}`} className={inputClass}
              placeholder={['z.B. Welchen Song wünschst du dir vom DJ?', 'Zweite Frage', 'Dritte Frage'][i]} />
          ))}
        </div>
      </SettingsSection>

      {!isTermin && (
        <SettingsSection id="zugang" title="Zugang und Gästeliste" open={open === 'zugang'} marker="indigo"
          summary={summary([
            onOff(event.inviteOnly, 'nur mit Einladung'), onOff(!!event.eventPin, 'PIN'), onOff(event.requireVerification, 'E-Mail-Bestätigung'),
            onOff(event.requireGuestUser, 'nur mit Konto'), onOff(event.isGuestListVisible, 'Gästeliste sichtbar')
          ], 'offen für alle mit Link')}>
          <input type="hidden" name="inviteOnlyShown" value="1" />
          <Check name="inviteOnly" defaultChecked={event.inviteOnly} label="💌 Nur mit Einladung"
            hint="Nur eingeladene Haushalte können antworten, jeder über seinen persönlichen Link (Reiter „Einladungen“). Ohne Link sehen Besucher*innen nur den Titel. Nicht zusammen mit PIN, E-Mail-Bestätigung, Konto-Pflicht oder Ticketkategorien." />
          <RuleNote name="inviteOnly" indent />
          <Field id="rsvpReminderDays" label="Erinnerung an Einladungen ohne Antwort (optional)" hint="Tage vor der Antwortfrist, einmal per Mail an Haushalte mit E-Mail.">
            <input id="rsvpReminderDays" type="number" name="rsvpReminderDays" min="1" max="60" defaultValue={event.rsvpReminderDays ?? ''} className={`${inputClass} sm:w-32`} placeholder="z.B. 7" />
            <RuleNote name="rsvpReminderDays" />
          </Field>
          <Field id="eventPin" label="PIN / Passwort (optional)" hint="Gäste müssen diesen Code eingeben, bevor sie Formular oder Gästeliste sehen.">
            <input id="eventPin" name="eventPin" defaultValue={event.eventPin || ''} className={`${inputClass} sm:w-64`} placeholder="leer = ohne PIN" />
            <RuleNote name="eventPin" />
          </Field>
          <Check name="requireVerification" defaultChecked={event.requireVerification} label="E-Mail-Bestätigung (Double-Opt-In)"
            hint="Eine Zusage gilt erst, wenn der Gast den Link in einer Mail anklickt. Braucht die E-Mail-Abfrage." />
          <RuleNote name="requireVerification" indent />
          <Check name="isGuestListVisible" defaultChecked={event.isGuestListVisible} label="Gästeliste für Gäste sichtbar"
            hint="Zeigt, wer kommt und was mitgebracht wird (ohne Kontaktdaten und Allergien)." />
          {event.requireGuestUser && <p className="text-sm text-gray-600 dark:text-gray-400">🔒 Nur mit Teilnehmendenkonto - beim Anlegen festgelegt, hier nicht änderbar.</p>}
        </SettingsSection>
      )}

      <SettingsSection id="ablauf" title="Erinnerung und Einlass" open={open === 'ablauf'} marker="teal"
        summary={summary([onOff(event.autoReminder, `Erinnerung ${event.reminderDays} Tage vorher`), onOff(event.enableCheckin, 'QR-Code-Einlass'), onOff(event.enableCheckin && event.trackPresence, 'Kommen und Gehen')])}>
        <Check name="autoReminder" defaultChecked={event.autoReminder} label="Automatische Erinnerung an alle Zusagen" hint="Per Mail (und Push), braucht die E-Mail-Abfrage und den Cronjob der Erinnerungen." />
        <Field id="reminderDays" label="Tage vor dem Event">
          <input id="reminderDays" type="number" name="reminderDays" min="1" max="30" defaultValue={event.reminderDays} className={`${inputClass} sm:w-32`} />
        </Field>
        <Check name="enableCheckin" defaultChecked={event.enableCheckin} label="Einlass mit QR-Code" hint="Bestätigte Gäste bekommen einen persönlichen QR-Code (Mail und Erfolgsseite), den ihr am Einlass scannt." />
        <Check name="trackPresence" defaultChecked={event.trackPresence} label="Kommen und Gehen protokollieren"
          hint="Für Sitzungen und Versammlungen: Wer geht, wird ausgecheckt statt ausgetragen, und kann wieder einchecken. Jedes Kommen und Gehen steht mit Uhrzeit im Reiter „Anwesenheit“ (Druck und CSV)." />
        <RuleNote name="trackPresence" indent />
      </SettingsSection>

      <SettingsSection id="menue" title="Menü" open={open === 'menue'} marker="orange" summary={event.menuCourses.length > 0 ? `${event.menuCourses.length} Gang/Gänge` : 'aus'}>
        <MenuFields courses={event.menuCourses.map(c => ({ label: c.label, options: courseOptions(c.options) }))} />
      </SettingsSection>

      <SettingsSection id="mitbringliste" title="Mitbringliste" open={open === 'mitbringliste'} marker="green" summary={event.bringSlots.length > 0 ? `${event.bringSlots.length} Einträge` : 'aus'}>
        <Field id="bringSlots" label="Einträge (optional)" hint="Eine Zeile pro Eintrag, Anzahl optional vorne: „2x Salat“, „3x Getränke“, „Nachtisch“. Gäste mit Zusage beanspruchen Einträge, volle sind gesperrt.">
          <textarea id="bringSlots" name="bringSlots" rows={4} defaultValue={formatBringSlots(event.bringSlots)} className={inputClass} placeholder={'2x Salat\n3x Getränke\nNachtisch'} />
        </Field>
        {isTermin && (
          <Check name="bringSaveAsTemplate" label="Als Vorlage der Reihe speichern"
            hint={event.series?.bringTemplate
              ? 'Neue Termine der Reihe bekommen diese Liste statt der bisherigen Vorlage. Die Listen bestehender Termine bleiben, wie sie sind.'
              : 'Neue Termine der Reihe bekommen diese Liste und lassen sich danach einzeln ändern. Die Vorlage steht auch in den Einstellungen der Reihe.'} />
        )}
      </SettingsSection>

      <SettingsSection id="wunschliste" title="Wunschliste" open={open === 'wunschliste'} marker="purple" summary={event.wishlist ? (event.wishesSecret ? 'an · Überraschung' : 'an') : 'aus'}>
        <input type="hidden" name="wishlistShown" value="1" />
        <Check name="wishlist" defaultChecked={event.wishlist} label="🎁 Wunschliste auf der Gästeseite"
          hint="Geschenke und Geldwünsche tragt ihr im Reiter „Wünsche“ ein. Gäste reservieren über ihren persönlichen Link, sobald sie geantwortet haben (bzw. eingeladen sind)." />
        <Check name="wishesSecret" defaultChecked={event.wishesSecret} label="Überraschung: ihr seht nicht, wer was schenkt"
          hint="Die Verwaltung sieht dann nur, was reserviert ist und wie viel Geld zusammenkommt. Ausschalten, wenn z. B. Trauzeug*innen die Liste führen und die Namen brauchen." />
      </SettingsSection>

      <SettingsSection id="tickets" title="Tickets und Bezahlung" open={open === 'tickets'} marker="pink" summary={event.ticketCategories.length > 0 ? `${event.ticketCategories.length} Kategorie(n)` : 'aus'}
        description="Kategorien mit Preis und Kontingent, z.B. für einen Ball. Mit Preis bekommen Gäste Betrag, Verwendungszweck und GiroCode; ihr markiert Zahlungen im Reiter „Gäste“ oder per Kontoauszug.">
        <TicketFields event={event} />
      </SettingsSection>

      <SettingsSection id="verknuepfungen" title="Verknüpfungen" open={open === 'verknuepfungen'} marker="lime"
        summary={summary([seatingUrl && 'Seating', timelineUrl && 'Zeitplan', shiftsUrl && 'Schichten', event.pollUrl && 'Abstimmung', event.photoUrl && 'Fotos', event.feedbackUrl && 'Feedback'], 'keine')}>
        {seatingOrigin && (
          <div>
            <Field id="seatingUrl" label="Sitzplätze (Seating)" hint={<>Link aus den Event-Einstellungen in Seating. ID dieses Termins für Seating: <code className="select-all">{event.id}</code>. Name, E-Mail und Begleitungen der Zusagen gehen dafür an Seating.</>}>
              <input id="seatingUrl" type="url" name="seatingUrl" defaultValue={seatingUrl} className={inputClass} placeholder={`${seatingOrigin}/rsvp/…`} />
            </Field>
            <SeatingPaymentToggle checked={event.seatingRequiresPayment} />
          </div>
        )}
        {timelineOrigin && (
          <Field id="timelineUrl" label="Zeitplan" hint={<>Link aus den Event-Einstellungen im Zeitplan. ID dieses Termins: <code className="select-all">{event.id}</code>. An den Zeitplan gehen nur Kennungen, keine Namen.</>}>
            <input id="timelineUrl" type="url" name="timelineUrl" defaultValue={timelineUrl} className={inputClass} placeholder={`${timelineOrigin}/rsvp/…`} />
          </Field>
        )}
        {shiftsOrigin && (
          <div className="space-y-3">
            <Field id="shiftsUrl" label="Helfer*innen (Schichten)" hint={<>Link aus den Einstellungen des Events in Schichten. ID dieses Termins für Schichten: <code className="select-all">{event.id}</code>. Schichten meldet Name, E-Mail und Zahl der Schichten aller Helfer*innen; wer genug Schichten hat, bekommt hier eine Zusage. Nicht zusammen mit „Nur mit Einladung“.</>}>
              <input id="shiftsUrl" type="url" name="shiftsUrl" defaultValue={shiftsUrl} className={inputClass} placeholder={`${shiftsOrigin}/rsvp/…`} />
              <RuleNote name="shiftsUrl" />
            </Field>
            <Field id="shiftTiers" label="Stufen: ab wie vielen Schichten welche Zusage" hint={event.ticketCategories.length > 0
              ? <>Eine Zeile pro Stufe, „Schichten: Kategorie“, z. B. „1: Helfer*innen“ und „5: Helfer*innen plus“. Die höchste erreichte Stufe gilt. Kapazität und Kontingente gelten für Helfer*innen nicht, der Preis der Kategorie schon. Leer = keine Helfer-Zusagen.</>
              : <>Ab wie vielen Schichten es eine Zusage gibt, z. B. „1“. Leer = keine Helfer-Zusagen.</>}>
              <textarea id="shiftTiers" name="shiftTiers" rows={2} defaultValue={formatShiftTiers(parseStoredTiers(event.shiftTiers), event.ticketCategories)} className={inputClass}
                placeholder={event.ticketCategories.length > 0 ? `1: ${event.ticketCategories[0].label}` : '1'} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pollUrl" label="Abstimmung (Link)">
            <input id="pollUrl" type="url" name="pollUrl" defaultValue={event.pollUrl || ''} className={inputClass} placeholder="https://abstimmung.example.de/xyz" />
          </Field>
          <Field id="pollLabel" label="Beschriftung des Knopfs">
            <input id="pollLabel" name="pollLabel" defaultValue={event.pollLabel || ''} className={inputClass} placeholder="z.B. Restaurant wählen" />
          </Field>
        </div>
        <Check name="datePending" defaultChecked={event.datePending} label="Datum noch offen - wird per Terminabstimmung festgelegt"
          hint="Nur mit einem Link auf eine Terminabstimmung. Das Datum oben ist dann ein Platzhalter (in der Zukunft wählen): keine Erinnerungen, kein Kalendereintrag. Steht der Termin fest, übernimmt ihn dieses Event und alle Zusagenden werden benachrichtigt." />
        <RuleNote name="datePending" indent />
        <Field id="photoUrl" label="Fotoalbum (Link)" hint="Geteiltes Album mit Upload (z.B. Immich). Gäste mit Zusage sehen den Link ab dem Ende des Termins.">
          <input id="photoUrl" type="url" name="photoUrl" defaultValue={event.photoUrl || ''} className={inputClass} placeholder="https://fotos.example.de/s/…" />
        </Field>
        {feedbackOrigin && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="feedbackUrl" label="Feedback-Fragebogen (Link)" hint={<>Fragebogen im Abstimmungstool mit „Gäste aus rsvp-app“. Gäste mit Zusage ({event.enableCheckin ? 'mit QR-Einlass nur Eingecheckte' : 'ohne QR-Einlass alle'}) sehen ab dem Ende „Feedback geben“. Ans Abstimmungstool geht nur ein Pseudonym, kein Name und keine E-Mail.</>}>
              <input id="feedbackUrl" type="url" name="feedbackUrl" defaultValue={event.feedbackUrl || ''} className={inputClass} placeholder={`${feedbackOrigin}/fragebogen/…`} />
            </Field>
            <Field id="feedbackDelayHours" label="Per Mail und Push verschicken" hint={event._count.rsvps > 0 ? `Bisher an ${event._count.rsvps} Zusage${event._count.rsvps === 1 ? '' : 'n'} verschickt, jede bekommt ihn nur einmal.` : 'Jede Zusage bekommt ihn einmal, über den Cronjob der Erinnerungen.'}>
              <select id="feedbackDelayHours" name="feedbackDelayHours" defaultValue={event.feedbackDelayHours ?? ''} className={inputClass}>
                <option value="">nicht verschicken (nur auf der Event-Seite)</option>
                {FEEDBACK_DELAY_OPTIONS.map(o => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        )}
      </SettingsSection>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:mx-0 sm:rounded-xl sm:border">
        <SettingsError />
        <NotifyGuestsToggle formId={formId} original={{ title: event.title, date: formattedDate, duration: String(event.duration), location: event.location || '', description: event.description || '' }} />
        <SubmitButton>Änderungen speichern</SubmitButton>
      </div>
    </SettingsForm>
  )
}
