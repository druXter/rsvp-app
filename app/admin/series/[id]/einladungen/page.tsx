// app/admin/series/[id]/einladungen/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { formatPersonList, invitationStatus } from '../../../../lib/invitations'
import { invitationCovers, invitationLink } from '../../../../lib/invitation-store'
import { formatEventDate, isArchived } from '../../../../lib/event-date'
import { sendInvitations } from '../../../invitation-actions'
import { ButtonLink, Card, Notice, buttonClass, inputClass } from '../../../../ui/kit'
import { AddInvitationsForm, DeleteInvitationButton, EditInvitationForm } from '../../../events/[id]/einladungen/invitation-forms'
import { StateBadge, personTotals, personsLine } from '../../../invitation-status'
import { loadAdminSeries } from '../series-access'

/**
 * Reiter "Einladungen" einer Reihe (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): eine Einladungsliste für die ganze
 * Reihe, ein Link pro Haushalt für alle bzw. ausgewählte Termine. Stand pro Termin und Haushalt, Anlegen per
 * Textfeld, Bearbeiten (auch der Termine), Mail und Druckliste. Für alle mit Zugriff auf die Reihe; Mails
 * verschicken nur Owner und Admins. Erinnerungen gehen pro Termin (dessen Reiter "Einladungen").
 */
export default async function SeriesInvitationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gesendet?: string }> }) {
  const { id } = await params
  const { gesendet } = await searchParams
  const loaded = await loadAdminSeries(id)
  if (!loaded) notFound()
  const { series, isOwner: canSend } = loaded

  const [termine, invitations] = await Promise.all([
    prisma.event.findMany({ where: { seriesId: series.id }, orderBy: { date: 'asc' }, select: { id: true, title: true, slug: true, date: true, datePending: true } }),
    prisma.invitation.findMany({
      where: { seriesId: series.id },
      include: {
        persons: { orderBy: { position: 'asc' } },
        events: { select: { eventId: true } },
        participant: { include: { rsvps: { include: { persons: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    })
  ])
  const current = termine.filter(t => !isArchived(t))
  const options = termine.map(t => ({ id: t.id, label: `${t.title} (${formatEventDate(t, 'short')})` }))
  const statusAt = (invitation: (typeof invitations)[number], eventId: string) =>
    invitationStatus(invitation.persons, invitation.participant.rsvps.find(r => r.eventId === eventId) ?? null)
  const unsent = invitations.filter(i => i.email && !i.sentAt).length

  return (
    <div className="space-y-6">
      {!series.inviteOnly && (
        <Notice tone="warning">
          Der Einladungsmodus ist für diese Reihe aus: Die Links funktionieren, aber jede*r mit dem Link der Reihe kann sich auch ohne Einladung anmelden. Einschalten unter „Einstellungen“ → „Einladungen“ → „Nur mit Einladung“.
        </Notice>
      )}
      {gesendet !== undefined && <Notice tone="success" role="status">✅ {gesendet} Einladung(en) per Mail verschickt.</Notice>}

      <Card>
        <p className="text-sm"><strong>{invitations.length} Haushalte</strong> eingeladen. Stand pro Termin:</p>
        <ul className="mt-2 space-y-1 text-sm" data-testid="invitation-summary">
          {current.map(t => {
            const statuses = invitations.filter(i => invitationCovers(i, { id: t.id, seriesId: series.id })).map(i => statusAt(i, t.id))
            const totals = personTotals(statuses)
            return (
              <li key={t.id} data-testid="termin-summary">
                <Link href={`/admin/events/${t.id}/einladungen`} className="font-medium hover:underline">{t.title}</Link>
                <span className="text-gray-600 dark:text-gray-400">: {statuses.length} Haushalte ({statuses.filter(s => s.state === 'open').length} ohne Antwort) · {totals.yes} kommen, {totals.no} kommen nicht, {totals.maybe > 0 ? `${totals.maybe} vielleicht, ` : ''}{totals.open} offen</span>
              </li>
            )
          })}
          {current.length === 0 && <li className="text-gray-500 dark:text-gray-400">Keine anstehenden Termine.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {canSend && unsent > 0 && (
            <form action={sendInvitations}>
              <input type="hidden" name="seriesId" value={series.id} />
              <button type="submit" className={buttonClass('primary', 'sm')}>Einladungen per Mail senden ({unsent} noch nicht gesendet)</button>
            </form>
          )}
          <ButtonLink href={`/admin/einladungen/reihe/${series.id}/druck`} size="sm">🖨️ Druckliste mit QR-Codes</ButtonLink>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">Einladungen hinzufügen</h2>
        <AddInvitationsForm seriesId={series.id} termine={options} />
      </Card>

      {invitations.length > 0 && (
        <ul className="space-y-3" data-testid="invitations">
          {invitations.map(invitation => {
            const link = invitationLink({ seriesSlug: series.slug }, invitation.participant)
            const covered = current.filter(t => invitationCovers(invitation, { id: t.id, seriesId: series.id }))
            return (
              <li key={invitation.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="invitation">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{invitation.label}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="invitation-termine">
                      Eingeladen zu: {invitation.allEvents ? 'allen Terminen' : termine.filter(t => invitation.events.some(e => e.eventId === t.id)).map(t => t.title).join(', ')}
                      {' · '}{invitation.email ?? 'keine E-Mail'}{invitation.sentAt ? ` · Mail gesendet am ${invitation.sentAt.toLocaleDateString('de-DE')}` : ''}
                      {invitation.note ? ` · Notiz: ${invitation.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canSend && invitation.email && (
                      <form action={sendInvitations}>
                        <input type="hidden" name="seriesId" value={series.id} />
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button type="submit" className={buttonClass('secondary', 'sm')}>{invitation.sentAt ? 'Erneut senden' : 'Senden'}</button>
                      </form>
                    )}
                    <DeleteInvitationButton invitationId={invitation.id} label={invitation.label} />
                  </div>
                </div>
                <ul className="space-y-1 text-sm">
                  {covered.map(t => {
                    const status = statusAt(invitation, t.id)
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-2" data-testid="invitation-termin">
                        <span className="text-gray-500 dark:text-gray-400">{t.title}:</span>
                        <StateBadge state={status.state} />
                        <span className="text-gray-700 dark:text-gray-300">{personsLine(status)}</span>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center gap-2">
                  <input readOnly value={link} aria-label={`Link für ${invitation.label}`} className={`${inputClass} font-mono text-xs`} />
                  <a href={link} target="_blank" rel="noopener" className="whitespace-nowrap text-xs text-blue-700 hover:underline dark:text-blue-300">Ansehen</a>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300">Bearbeiten</summary>
                  <EditInvitationForm
                    termine={options}
                    invitation={{
                      id: invitation.id, label: invitation.label, email: invitation.email, persons: formatPersonList(invitation.persons), extraPersons: invitation.extraPersons, note: invitation.note,
                      allEvents: invitation.allEvents, eventIds: invitation.events.map(e => e.eventId)
                    }}
                  />
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
