// app/admin/edit-rsvp/[id]/page.tsx
import { formatEuro } from '../../../lib/payment-state'
import { prisma } from '../../../lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { updateAdminRsvp } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import CompanionFields from '../../../ui/companion-fields'
import { companionsOf, MAX_COMPANIONS, menuOf } from '../../../lib/persons'
import { menuForForm } from '../../../lib/menu-store'
import { invitationCovers } from '../../../lib/invitation-store'
import MenuSelects from '../../../ui/menu-selects'
import AdminShell from '../../admin-shell'
import { RSVP_NOTE_MAX } from '../../../lib/rsvp-note'
import { Badge, PageHeader, inputClass, SubmitButton } from '../../../ui/kit'


/**
 * Admin-Ansicht zur manuellen Bearbeitung einer einzelnen Gast-Antwort.
 * Ermöglicht Korrekturen durch den Administrator, falls Gäste sich vertippt haben oder nachträgliche Änderungen mitteilen.
 */
export default async function EditRsvpPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  // Die spezifische Antwort aus der Datenbank abrufen (inkl. des geteilten Gast-Profils)
  const { id } = await params
  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { participant: true, note: true, persons: { orderBy: { position: 'asc' }, include: { menuChoices: true } }, event: { include: { ticketCategories: { orderBy: { position: 'asc' } } } } } })

  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return <div className="p-8 dark:text-gray-100">Antwort nicht gefunden.</div>

  const participant = rsvp.participant
  // Begleitungen: wie in updateAdminRsvp, nicht bei Ticketkategorien
  // Antwort eines eingeladenen Haushalts: Personen und Zu-/Absage pro Person nur über den Einladungslink
  const invitation = await prisma.invitation.findUnique({ where: { participantId: participant.id }, include: { event: { select: { slug: true } }, series: { select: { slug: true } }, events: { select: { eventId: true } } } })
  const household = invitation && invitationCovers(invitation, rsvp.event) ? invitation : null
  const showCompanions = !household && rsvp.event.ticketCategories.length === 0 && (rsvp.event.maxCompanions > 0 || rsvp.persons.length > 0)
  const menu = await menuForForm(rsvp.event.id)

  return (
    <AdminShell user={user} width="narrow">
      <PageHeader title={`Antwort von ${participant.name}`} subtitle={rsvp.event.title} back={{ href: `/admin/events/${rsvp.eventId}/gaeste`, label: 'Zurück zu den Gästen' }} />
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 space-y-6 text-gray-900 dark:text-gray-100">

        <form action={updateAdminRsvp} className="space-y-4">
          <input type="hidden" name="rsvpId" value={rsvp.id} />

          {/* Raster-Layout (Grid) für eine kompaktere Darstellung der Eingabefelder */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Name</label>
              <input id="name" type="text" name="name" defaultValue={participant.name} required className={inputClass} />
            </div>
            <div className={household ? 'hidden' : ''}>
              <label htmlFor="isAttending" className="block text-sm font-medium mb-1">Status</label>
              <select id="isAttending" name="isAttending" defaultValue={rsvp.isMaybe ? 'maybe' : rsvp.isAttending ? 'true' : 'false'} className={inputClass}>
                <option value="true">Zusage</option>
                <option value="false">Absage</option>
                {/* „Vielleicht“ setzt der Gast selbst oder die Verwaltung beim Eintragen von Hand - hier nur beibehalten */}
                {rsvp.isMaybe && <option value="maybe">Vielleicht (vom Gast, bleibt)</option>}
              </select>
            </div>
          </div>

          {rsvp.event.ticketCategories.length > 0 && (
            <div>
              <label htmlFor="ticketCategoryId" className="block text-sm font-medium mb-1">Ticketkategorie</label>
              <select id="ticketCategoryId" name="ticketCategoryId" defaultValue={rsvp.ticketCategoryId ?? ''} className={inputClass}>
                {!rsvp.ticketCategoryId && <option value="">Keine</option>}
                {rsvp.event.ticketCategories.map(c => <option key={c.id} value={c.id}>{c.label} ({formatEuro(c.priceCents)})</option>)}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hier gilt kein Kontingent (wie „Zulassen“). {rsvp.paidAt ? 'Bereits bezahlt: Der Betrag bleibt bei einem Wechsel stehen.' : 'Der Betrag folgt dem Preis der neuen Kategorie.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
              <input id="email" type="email" name="email" defaultValue={participant.email || ''} className={inputClass} />
              {participant.email && (
                <p className="mt-1" data-testid="email-status">
                  {participant.isVerified ? <Badge tone="green">bestätigt</Badge> : <Badge tone="amber">nicht bestätigt</Badge>}
                </p>
              )}
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" name="emailVerified" className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>{participant.isVerified ? 'Geänderte Adresse ist bestätigt' : 'Adresse ist bestätigt'}</span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Änderst du die Adresse, ist sie danach unbestätigt - außer mit Haken.</p>
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1">Handy</label>
              <input id="phone" type="tel" name="phone" defaultValue={participant.phone || ''} className={inputClass} />
            </div>
          </div>

          {household && (
            <p className="text-sm bg-indigo-50 text-indigo-900 p-3 rounded border border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800" data-testid="household-note">
              💌 Antwort des eingeladenen Haushalts „{household.label}“. Wer kommt, Essen und Menü pro Person bearbeitest du über den{' '}
              <a href={household.series ? `/reihe/${household.series.slug}/${rsvp.event.slug}?token=${participant.editToken}` : `/${household.event!.slug}?token=${participant.editToken}`} target="_blank" rel="noopener" className="underline">Einladungslink</a>, die Personen der Einladung unter{' '}
              <Link href={household.seriesId ? `/admin/series/${household.seriesId}/einladungen` : `/admin/events/${rsvp.eventId}/einladungen`} className="underline">Einladungen</Link>.
            </p>
          )}

          {menu.length > 0 && !household && (
            <fieldset className="pt-4 border-t dark:border-gray-700">
              <legend className="block text-sm font-medium mb-1">Menü von {participant.name}</legend>
              <input type="hidden" name="menuShown" value="1" />
              <MenuSelects courses={menu} prefix="menu_" selection={rsvp.persons[0] ? menuOf(rsvp.persons[0]) : {}} who="" required={false} />
            </fieldset>
          )}

          {showCompanions && (
            <div className="pt-4 border-t dark:border-gray-700">
              <CompanionFields max={MAX_COMPANIONS} initial={companionsOf(rsvp.persons)} askDiet askAllergies askAlcohol menu={menu} required={false} />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hier gilt weder das Höchstmaß des Termins ({rsvp.event.maxCompanions}) noch die Kapazität (wie „Zulassen“).</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dietaryOption" className="block text-sm font-medium mb-1">Essen</label>
              <select id="dietaryOption" name="dietaryOption" defaultValue={participant.dietaryOption || ''} className={inputClass}>
                <option value="">Keine Angabe</option>
                <option value="Allesesser">Allesesser</option>
                <option value="Vegetarisch">Vegetarisch</option>
                <option value="Vegan">Vegan</option>
              </select>
            </div>
            <div>
              <label htmlFor="drinksAlcohol" className="block text-sm font-medium mb-1">Alkohol?</label>
              <select id="drinksAlcohol" name="drinksAlcohol" defaultValue={rsvp.drinksAlcohol === true ? 'true' : rsvp.drinksAlcohol === false ? 'false' : ''} className={inputClass}>
                <option value="">Keine Angabe</option>
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="allergies" className="block text-sm font-medium mb-1">Allergien</label>
            <input id="allergies" type="text" name="allergies" defaultValue={participant.allergies || ''} className={inputClass} />
          </div>

          <div>
            <label htmlFor="bringingItem" className="block text-sm font-medium mb-1">Mitbringsel</label>
            <input id="bringingItem" type="text" name="bringingItem" defaultValue={rsvp.bringingItem || ''} className={inputClass} />
          </div>

          <div>
            <label htmlFor="additionalInfoOrDeclineReason" className="block text-sm font-medium mb-1">Anmerkungen (bei Zusage) / Grund (bei Absage)</label>
            {/*
              Dynamische Zuordnung des Feldes:
              Das Datenbankfeld (additionalInfo oder declineReason) variiert je nach Teilnahmestatus.
            */}
            <textarea
              id="additionalInfoOrDeclineReason"
              name={rsvp.isAttending ? 'additionalInfo' : 'declineReason'}
              defaultValue={rsvp.isAttending ? (rsvp.additionalInfo || '') : (rsvp.declineReason || '')}
              rows={3}
              className={inputClass}
            ></textarea>
          </div>

          <div className="pt-4 border-t dark:border-gray-700">
            <label htmlFor="adminNote" className="block text-sm font-medium mb-1">Notiz (nur für euch)</label>
            <textarea id="adminNote" name="adminNote" defaultValue={rsvp.note?.text ?? ''} maxLength={RSVP_NOTE_MAX} rows={2} placeholder="z. B. telefonisch zugesagt" className={inputClass}></textarea>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Steht in der Gästeliste und im CSV-Export, der Gast sieht sie nie.</p>
          </div>

          <SubmitButton>Änderungen speichern</SubmitButton>
        </form>
      </div>
    </AdminShell>
  )
}