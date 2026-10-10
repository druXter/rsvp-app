// app/admin/events/[id]/einstellungen/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import EventSettingsForm, { SETTINGS_INCLUDE } from '../../../event-settings-form'
import ShareAccessPanel from '../../../share-access-panel'
import DeleteButton from '../../../delete-button'
import { Notice } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'

const SECTIONS = ['grunddaten', 'formular', 'zugang', 'ablauf', 'menue', 'mitbringliste', 'tickets', 'verknuepfungen']

/**
 * Reiter "Einstellungen" (nur Owner und Admins): das gegliederte Formular (app/admin/event-settings-form.tsx),
 * darunter bei Einzel-Events die Freigaben für Moderator*innen und das Löschen. `?abschnitt=` klappt einen
 * Abschnitt auf (z.B. nach dem Anlegen), `?gespeichert=1` bestätigt das Speichern.
 */
export default async function EventSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gespeichert?: string; neu?: string; abschnitt?: string; shareError?: string }> }) {
  const { id } = await params
  const { gespeichert, neu, abschnitt, shareError } = await searchParams
  const loaded = await loadAdminEvent(id)
  if (!loaded || !loaded.isOwner) notFound()
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { ...SETTINGS_INCLUDE, sharedWith: { include: { user: { select: { email: true } } } } } })

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {gespeichert && <Notice tone="success" role="status">✅ Gespeichert.</Notice>}
      {neu && <Notice tone="success" role="status">🎉 Event angelegt. Hier stellt ihr alles Weitere ein - die Abschnitte lassen sich auf- und zuklappen.</Notice>}
      <EventSettingsForm event={event} open={SECTIONS.includes(abschnitt ?? '') ? abschnitt : 'grunddaten'} />

      {!event.seriesId && (
        <div className="pt-6">
          <ShareAccessPanel eventId={event.id} shares={event.sharedWith.map(a => ({ id: a.id, email: a.user.email }))} error={shareError} />
        </div>
      )}

      <div className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-gray-800">
        <h2 className="font-semibold text-red-800 dark:text-red-300">Event löschen</h2>
        <p className="mt-1 mb-3 text-sm text-gray-600 dark:text-gray-400">Löscht das Event mit allen Antworten{event.inviteOnly ? ' und Einladungen' : ''}. Das lässt sich nicht rückgängig machen.</p>
        <DeleteButton eventId={event.id} />
      </div>
    </div>
  )
}
