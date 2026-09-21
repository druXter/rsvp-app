// app/admin/series/[id]/edit/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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
  searchParams: Promise<{ shareError?: string; guestError?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { id } = await params
  const { shareError, guestError } = await searchParams
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
    return <div className="p-8">Reihe nicht gefunden.</div>
  }

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6 text-gray-900 dark:text-gray-100">

        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">{isOwner ? 'Reihe bearbeiten' : 'Nutzer-Mitglieder verwalten'}</h1>
          <Link href={`/admin/series/${series.id}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">
            {isOwner ? 'Abbrechen' : '← Zurück'}
          </Link>
        </div>

        {series.requireGuestUser && (
          <p className="text-xs bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded p-2">
            🔒 Nur registrierte Teilnehmer erlaubt - das wurde beim Anlegen festgelegt und kann hier nicht mehr geändert werden.
          </p>
        )}

        {isOwner && (
        <form id="edit-series-form" action={updateEventSeries} className="space-y-4">
          <input type="hidden" name="seriesId" value={series.id} />

          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">Titel der Reihe</label>
            <input id="title" type="text" name="title" defaultValue={series.title} required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded" />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium mb-1">URL-Wort (Slug)</label>
            <input id="slug" type="text" name="slug" defaultValue={series.slug} required className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded" />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1">Beschreibung</label>
            <textarea id="description" name="description" defaultValue={series.description || ''} rows={3} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded"></textarea>
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
              <input id="eventPin" type="text" name="eventPin" defaultValue={series.eventPin || ''} className={`w-full border ${themeClasses('indigo').border} p-2 rounded outline-none ${themeClasses('indigo').borderFocus}`} placeholder="leer lassen für öffentliche Reihe" />
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
    </main>
  )
}
