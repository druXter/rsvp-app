// app/admin/einladungen/[eventId]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove, isOwnerOrAdmin } from '../../../lib/permissions'
import { formatPersonList, invitationStatus } from '../../../lib/invitations'
import { invitationLink } from '../../../lib/invitation-store'
import { formatDeadline } from '../../../lib/rsvp-deadline'
import { remindInvitations, sendInvitations } from '../../invitation-actions'
import { AddInvitationsForm, DeleteInvitationButton, EditInvitationForm } from './invitation-forms'

const STATE_LABEL = { open: 'offen', attending: 'zugesagt', waitlist: 'Warteliste', declined: 'abgesagt' }
const STATE_CLASS = {
  open: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  attending: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  waitlist: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  declined: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}
const PERSON_MARK = { yes: '✓', no: '✗', open: '?' }

/**
 * Einladungen eines Termins (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): Stand pro Haushalt und Person, Summen,
 * Anlegen per Textfeld, Bearbeiten, Link und Mail pro Haushalt, Druckliste mit QR-Codes. Für alle mit Zugriff
 * auf die Gästeliste; Mails verschicken nur Owner und Admins. Farbe indigo wie der Einladungsmodus im Formular.
 */
export default async function InvitationsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ gesendet?: string; erinnert?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const { eventId } = await params
  const { gesendet, erinnert } = await searchParams
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.seriesId || !(await hasEventModeratorOrAbove(user, event))) return notFound()
  const canSend = isOwnerOrAdmin(user, event.ownerId)

  const invitations = await prisma.invitation.findMany({
    where: { eventId },
    include: {
      persons: { orderBy: { position: 'asc' } },
      participant: { include: { rsvps: { where: { eventId }, include: { persons: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  })
  const rows = invitations.map(invitation => ({
    invitation,
    status: invitationStatus(invitation.persons, invitation.participant.rsvps[0] ?? null),
    link: invitationLink(event, invitation.participant)
  }))
  const persons = rows.flatMap(r => r.status.persons)
  const count = (filter: (p: (typeof persons)[number]) => boolean) => persons.filter(filter).length
  const unsent = invitations.filter(i => i.email && !i.sentAt).length
  const openWithEmail = rows.filter(r => r.invitation.email && r.status.state === 'open').length
  const deadline = formatDeadline(event.rsvpDeadline)

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-5xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6 text-gray-900 dark:text-gray-100">
        <div className="flex flex-wrap gap-2 justify-between items-center border-b dark:border-gray-700 pb-4">
          <h1 className="text-2xl font-bold">💌 Einladungen: {event.title}</h1>
          <div className="flex gap-3 items-center">
            <Link href={`/admin/einladungen/${event.id}/druck`} className="text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline">🖨️ Druckliste mit QR-Codes</Link>
            <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">Zur Verwaltung</Link>
          </div>
        </div>

        {!event.inviteOnly && (
          <p className="text-sm bg-amber-50 text-amber-900 p-3 rounded border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
            Der Einladungsmodus ist für diesen Termin aus: Die Links funktionieren, aber jede*r mit dem Event-Link kann sich auch ohne Einladung anmelden. Einschalten unter „Bearbeiten“ → „Nur mit Einladung“.
          </p>
        )}
        {erinnert !== undefined && <p role="status" className="text-sm bg-green-50 text-green-800 p-3 rounded border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">✅ {erinnert} Erinnerung(en) verschickt.</p>}
        {gesendet !== undefined && <p role="status" className="text-sm bg-green-50 text-green-800 p-3 rounded border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">✅ {gesendet} Einladung(en) per Mail verschickt.</p>}

        <p className="text-sm" data-testid="invitation-summary">
          {invitations.length} Haushalte ({rows.filter(r => r.status.state === 'open').length} ohne Antwort) · Personen: {count(p => p.status === 'yes')} kommen
          ({count(p => p.status === 'yes' && p.ageGroup === 'ADULT')} Erwachsene, {count(p => p.status === 'yes' && p.ageGroup === 'CHILD')} Kinder, {count(p => p.status === 'yes' && p.ageGroup === 'INFANT')} Kleinkinder),
          {' '}{count(p => p.status === 'no')} kommen nicht, {count(p => p.status === 'open')} offen
          {deadline && <> · Antwortfrist: {deadline}</>}
        </p>

        {canSend && (unsent > 0 || openWithEmail > 0) && (
          <div className="flex flex-wrap gap-2">
            {unsent > 0 && (
              <form action={sendInvitations}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700">✉️ Einladungen per Mail senden ({unsent} noch nicht gesendet)</button>
              </form>
            )}
            {openWithEmail > 0 && (
              <form action={remindInvitations}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className="px-3 py-1.5 text-sm font-medium rounded border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950">⏰ Erinnerung an {openWithEmail} ohne Antwort senden</button>
              </form>
            )}
          </div>
        )}

        <AddInvitationsForm eventId={event.id} />

        {rows.length === 0 ? (
          <p className="text-sm italic text-gray-500 dark:text-gray-400">Noch keine Einladungen.</p>
        ) : (
          <ul className="space-y-3" data-testid="invitations">
            {rows.map(({ invitation, status, link }) => (
              <li key={invitation.id} className="p-4 rounded border border-indigo-200 dark:border-indigo-800 space-y-2" data-testid="invitation">
                <div className="flex flex-wrap gap-2 justify-between items-start">
                  <div>
                    <span className="font-bold">{invitation.label}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-bold ${STATE_CLASS[status.state]}`}>{STATE_LABEL[status.state]}</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {status.persons.map(p => `${PERSON_MARK[p.status]} ${p.name}${p.ageGroup === 'CHILD' ? ' (Kind)' : p.ageGroup === 'INFANT' ? ' (Kleinkind)' : ''}${p.extra ? ' +' : ''}`).join(' · ')}
                      {invitation.extraPersons > 0 && ` · bis zu ${invitation.extraPersons} weitere`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {invitation.email ?? 'keine E-Mail'}{invitation.sentAt ? ` · Mail gesendet am ${invitation.sentAt.toLocaleDateString('de-DE')}` : ''}
                      {invitation.note ? ` · Notiz: ${invitation.note}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    {canSend && invitation.email && (
                      <form action={sendInvitations}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button type="submit" className="px-2 py-1 text-xs font-medium rounded border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950">
                          ✉️ {invitation.sentAt ? 'erneut senden' : 'senden'}
                        </button>
                      </form>
                    )}
                    <DeleteInvitationButton invitationId={invitation.id} label={invitation.label} />
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <input readOnly value={link} aria-label={`Link für ${invitation.label}`} className="flex-1 text-xs font-mono bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded p-1.5" />
                  <a href={link} target="_blank" rel="noopener" className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline whitespace-nowrap">Antwort ansehen</a>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-indigo-700 dark:text-indigo-300">Bearbeiten</summary>
                  <EditInvitationForm invitation={{ id: invitation.id, label: invitation.label, email: invitation.email, persons: formatPersonList(invitation.persons), extraPersons: invitation.extraPersons, note: invitation.note }} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
