// app/admin/ticket-settings-section.tsx
import ThemeSection, { themeClasses } from '../ui/theme-section'
import { formatTicketCategories, type TicketCategoryInput } from '../lib/tickets'
import { formatIban } from '../lib/payment'

type TicketSettings = {
  ticketCategories: TicketCategoryInput[]
  paymentRecipient: string | null
  paymentIban: string | null
  paymentBic: string | null
  paymentDueDays: number | null
  paymentReminderDays: number | null
}

const input = `w-full border ${themeClasses('pink').border} bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded outline-none ${themeClasses('pink').borderFocus}`
const label = `block text-sm font-medium mb-1 ${themeClasses('pink').heading}`

/**
 * "Tickets und Bezahlung" im Termin-Formular (Anlegen, Bearbeiten, Reihen-Termin): Kategorien mit Preis und
 * Kontingent (app/lib/tickets.ts) und das Konto für Überweisungen (app/lib/payment.ts). Gelesen von
 * readTicketing in app/admin/actions.ts. Farbe pink = Tickets und Bezahlung (siehe CLAUDE.md "Farbschema").
 */
export default function TicketSettingsSection({ event }: { event?: TicketSettings }) {
  return (
    <ThemeSection color="pink" title="Tickets und Bezahlung" description="Optional: Kategorien mit Preis und Kontingent, z. B. für einen Ball. Gäste wählen beim Zusagen eine Kategorie, volle Kategorien führen auf die Warteliste. Mit Preis bekommen Gäste Betrag, Verwendungszweck und GiroCode zum Überweisen; ihr markiert Zahlungen in der Gästeliste. Bei Kategorien gibt es keine Begleitung - jede Person meldet sich selbst an.">
      <div>
        <label htmlFor="ticketCategories" className={label}>Kategorien (Optional)</label>
        <textarea id="ticketCategories" name="ticketCategories" rows={4} defaultValue={event ? formatTicketCategories(event.ticketCategories) : ''} className={input} placeholder={'Studierende; 25; 120\nGäste; 35,50\nHelfer*innen; 0; 20'} />
        <p className={`text-xs ${themeClasses('pink').text} mt-1`}>Eine Zeile pro Kategorie: Bezeichnung; Preis in Euro; Kontingent. Preis und Kontingent sind optional. Ein neuer Preis gilt nur für neue Zusagen. Eine Kategorie mit Antworten lässt sich nicht entfernen oder umbenennen.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="paymentRecipient" className={label}>Empfänger*in (Kontoinhaber)</label>
          <input id="paymentRecipient" name="paymentRecipient" maxLength={70} defaultValue={event?.paymentRecipient ?? ''} className={input} placeholder="Fachschaft Musterfach" />
        </div>
        <div>
          <label htmlFor="paymentIban" className={label}>IBAN</label>
          <input id="paymentIban" name="paymentIban" defaultValue={event?.paymentIban ? formatIban(event.paymentIban) : ''} className={`${input} font-mono`} placeholder="DE00 0000 0000 0000 0000 00" />
        </div>
        <div>
          <label htmlFor="paymentBic" className={label}>BIC (Optional)</label>
          <input id="paymentBic" name="paymentBic" defaultValue={event?.paymentBic ?? ''} className={`${input} font-mono`} />
        </div>
        <div>
          <label htmlFor="paymentDueDays" className={label}>Zahlfrist in Tagen (Optional)</label>
          <input id="paymentDueDays" name="paymentDueDays" type="number" min={1} max={365} defaultValue={event?.paymentDueDays ?? ''} className={input} placeholder="z. B. 14" />
        </div>
        <div>
          <label htmlFor="paymentReminderDays" className={label}>Zahlungserinnerung, Tage vor Fristende (Optional)</label>
          <input id="paymentReminderDays" name="paymentReminderDays" type="number" min={1} max={60} defaultValue={event?.paymentReminderDays ?? ''} className={input} placeholder="z. B. 3" />
        </div>
      </div>
      <p className={`text-xs ${themeClasses('pink').text}`}>Empfänger*in und IBAN sind Pflicht, sobald eine Kategorie etwas kostet. Die Frist zählt ab dem festen Platz und wird nur angezeigt: Überfällige Zusagen könnt ihr in der Gästeliste stornieren, nichts verfällt automatisch. Mit Zahlungserinnerung bekommen offene Zahlungen einmal pro Frist automatisch eine Mail (und Push), braucht den Cronjob der Erinnerungen; per Knopf in der Gästeliste geht das jederzeit.</p>
    </ThemeSection>
  )
}

/** Schalter im Seating-Abschnitt: Sitzplatzwahl erst nach Zahlung (Event.seatingRequiresPayment). */
export function SeatingPaymentToggle({ checked }: { checked: boolean }) {
  return (
    <div className="mt-3">
      <input type="hidden" name="seatingRequiresPaymentShown" value="1" />
      <label className={`flex items-start gap-2 text-sm ${themeClasses('lime').heading}`}>
        <input type="checkbox" name="seatingRequiresPayment" defaultChecked={checked} className="mt-1 w-4 h-4" />
        <span>
          Sitzplatzwahl erst nach Zahlung
          <span className={`block text-xs ${themeClasses('lime').text}`}>Zusagen mit offenem Betrag zählen bei Seating erst, wenn ihr sie als bezahlt markiert. Achtung: Beim Einschalten verlieren unbezahlte Zusagen einen schon gewählten Platz.</span>
        </span>
      </label>
    </div>
  )
}
