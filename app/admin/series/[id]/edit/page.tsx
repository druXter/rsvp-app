// app/admin/series/[id]/edit/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'
import { Notice, inputClass } from '../../../../ui/kit'
import { updateEventSeries } from '../../../actions'
import { getCurrentUser } from '../../../../lib/auth'
import { isOwnerOrAdmin, hasSeriesModeratorOrAbove } from '../../../../lib/permissions'
import ShareAccessPanel from '../../../share-access-panel'
import GuestMembersPanel from '../../../guest-members-panel'
import SubmitButton from '../../../../ui/submit-button'
import ThemeSection, { themeClasses } from '../../../../ui/theme-section'

const prisma = new PrismaClient()

export default async function EditEventSeriesPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ shareError?: string; guestError?: string; gespeichert?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { id } = await params
  const { shareError, guestError, gespeichert } = await searchParams
  const series = await prisma.eventSeries.findUnique({
    where: { id },
    include: {
      sharedWith: { include: { user: { select: { email: true } } } },
      guestMembers: { include: { guestUser: { select: { email: true, name: true } } } }
    }
  })

  const isOwner = !!series && isOwnerOrAdmin(user, series.ownerId)
  const isModerator = !!series && !isOwner && (await hasSeriesModeratorOrAbove(user, series))

  if (!series || (!isOwner && !isModerator)) {
    return notFound()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
        {gespeichert && <Notice tone="success" role="status">✅ Gespeichert.</Notice>}

        {series.requireGuestUser && (
          <p className="text-xs bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded p-2">
            🔒 Nur registrierte Teilnehmer erlaubt - das wurde beim Anlegen festgelegt und kann hier nicht mehr geändert werden.
          </p>
        )}

        {isOwner && (
        <form id="edit-series-form" action={updateEventSeries} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Einstellungen der Reihe</h2>
          <input type="hidden" name="seriesId" value={series.id} />

          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">Titel der Reihe</label>
            <input id="title" type="text" name="title" defaultValue={series.title} required className={inputClass} />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input id="slug" type="text" name="slug" defaultValue={series.slug} required className={inputClass} />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1">Beschreibung</label>
            <textarea id="description" name="description" defaultValue={series.description || ''} rows={3} className={inputClass}></textarea>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Welche Profil-Felder sollen EINMALIG für die ganze Reihe abgefragt werden?</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askEmail" defaultChecked={series.askEmail} className="w-4 h-4" />
              <span>E-Mail Adresse abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askPhone" defaultChecked={series.askPhone} className="w-4 h-4" />
              <span>Handynummer abfragen</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askDiet" defaultChecked={series.askDiet} className="w-4 h-4" />
              <span>Essenswünsche abfragen (Veggie/Vegan)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="askAllergies" defaultChecked={series.askAllergies} className="w-4 h-4" />
              <span>Allergien abfragen</span>
            </label>
          </div>

          <ThemeSection color="yellow" title="E-Mail-Verifizierung (Double-Opt-In)" description="Gilt einmalig für die ganze Reihe. (Erfordert E-Mail-Abfrage oben).">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="requireVerification" defaultChecked={series.requireVerification} className={`w-4 h-4 ${themeClasses('yellow').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('yellow').heading}`}>Verifizierung zwingend erforderlich</span>
            </label>
          </ThemeSection>

          <ThemeSection color="indigo" title="Gruppen- & Vereins-Features (gelten für alle Termine der Reihe)">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" name="isGuestListVisible" defaultChecked={series.isGuestListVisible} className={`w-4 h-4 ${themeClasses('indigo').accent}`} />
              <span className={`text-sm font-medium ${themeClasses('indigo').heading}`}>Transparente Gästeliste (Zeigt Wer kommt & Mitbringsel)</span>
            </label>

            <div>
              <label htmlFor="eventPin" className={`block text-sm font-medium mb-1 ${themeClasses('indigo').heading}`}>Reihen-PIN / Passwort (Optional)</label>
              <input id="eventPin" type="text" name="eventPin" defaultValue={series.eventPin || ''} className={inputClass} placeholder="leer lassen für öffentliche Reihe" />
            </div>
          </ThemeSection>

        </form>
        )}

        {isOwner && (
          <ShareAccessPanel
            seriesId={series.id}
            shares={series.sharedWith.map(a => ({ id: a.id, email: a.user.email }))}
            error={shareError}
          />
        )}

        {isOwner && <SubmitButton form="edit-series-form">Änderungen speichern</SubmitButton>}

        <GuestMembersPanel
          seriesId={series.id}
          members={series.guestMembers.map(m => ({ membershipId: m.id, email: m.guestUser.email, name: m.guestUser.name }))}
          error={guestError}
        />
    </div>
  )
}
