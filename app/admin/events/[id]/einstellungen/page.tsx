// app/admin/events/[id]/einstellungen/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import EventSettingsForm, { SETTINGS_INCLUDE } from '../../../event-settings-form'
import ShareAccessPanel from '../../../share-access-panel'
import DeleteButton from '../../../delete-button'
import { Notice } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import { LinkedCreateForm } from '../../../linked-create'
import { createLinkedToolEvent } from '../../../actions'
import { isCreatableTool } from '../../../../lib/linked-create'
import { toolDefinition } from '../../../../lib/linked-tools'
import { countOpenMaybes } from '../../../../lib/maybe-store'

const SECTIONS = ['grunddaten', 'formular', 'zugang', 'ablauf', 'menue', 'mitbringliste', 'tickets', 'verknuepfungen']

/**
 * Reiter "Einstellungen" (nur Owner und Admins): das gegliederte Formular (app/admin/event-settings-form.tsx),
 * darunter bei Einzel-Events die Freigaben für Moderator*innen und das Löschen. `?abschnitt=` klappt einen
 * Abschnitt auf (z.B. nach dem Anlegen), `?gespeichert=1` bestätigt das Speichern.
 */
export default async function EventSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gespeichert?: string; neu?: string; abschnitt?: string; shareError?: string; tool?: string; angelegt?: string; anlegen?: string }> }) {
  const { id } = await params
  const { gespeichert, neu, abschnitt, shareError, tool, angelegt, anlegen } = await searchParams
  const loaded = await loadAdminEvent(id)
  if (!loaded || !loaded.isOwner) notFound()
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { ...SETTINGS_INCLUDE, sharedWith: { include: { user: { select: { email: true } } } } } })

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {gespeichert && <Notice tone="success" role="status">✅ Gespeichert.</Notice>}
      {neu && <Notice tone="success" role="status">🎉 Event angelegt. Hier stellt ihr alles Weitere ein - die Abschnitte lassen sich auf- und zuklappen.</Notice>}
      {isCreatableTool(tool) && <LinkedCreateNotice label={toolDefinition(tool).label} angelegt={angelegt} anlegen={anlegen} remoteId={event.toolLinks.find(l => l.type === tool)?.remoteEventId} url={event.toolLinks.find(l => l.type === tool)?.url} />}
      <EventSettingsForm event={event} userId={loaded.user.id} open={SECTIONS.includes(abschnitt ?? '') ? abschnitt : 'grunddaten'} openMaybes={await countOpenMaybes([event.id])} />
      <LinkedCreateForm eventId={event.id} action={createLinkedToolEvent} />

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

const FAILED: Record<string, (label: string) => string> = {
  schon: label => `Der Termin ist schon mit ${label} verknüpft.`,
  einladung: label => `${label} geht nicht zusammen mit „Nur mit Einladung“.`,
  'no-account': label => `Für das Anlegen in ${label} brauchst du dort ein Konto, das mit deinem Konto hier verbunden ist - siehe Hinweis unter „Verknüpfungen“.`,
  'no-permission': label => `Dein Konto in ${label} darf keine Events anlegen.`,
  taken: label => `${label} hat schon ein Event zu diesem Termin, das du dort nicht verwaltest.`,
  fehler: label => `Anlegen in ${label} hat nicht geklappt, ${label} ist gerade nicht erreichbar. Bitte später noch einmal.`
}

/** Ergebnis von „Im Zeitplan anlegen“ bzw. „In Schichten anlegen“ (createLinkedToolEvent). */
function LinkedCreateNotice({ label, angelegt, anlegen, remoteId, url }: { label: string; angelegt?: string; anlegen?: string; remoteId?: string; url?: string }) {
  if ((angelegt === 'created' || angelegt === 'linked') && remoteId && url) {
    const admin = `${new URL(url).origin}/admin/events/${remoteId}`
    return (
      <Notice tone="success" role="status">
        ✅ {angelegt === 'created' ? `In ${label} angelegt und verknüpft` : `Mit dem Event in ${label} verknüpft`}.{' '}
        <a href={admin} target="_blank" rel="noopener noreferrer" className="underline">In {label} öffnen</a>{angelegt === 'created' ? ' - es ist noch ein Entwurf.' : ''}
      </Notice>
    )
  }
  const reason = anlegen && Object.hasOwn(FAILED, anlegen) ? FAILED[anlegen] : undefined
  return reason ? <Notice tone="error" role="alert">{reason(label)}</Notice> : null
}
