// app/admin/events/[id]/einladungen/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { formatPersonList, invitationStatus } from '../../../../lib/invitations'
import { invitationLink, invitationsForEvent } from '../../../../lib/invitation-store'
import { formatDeadline } from '../../../../lib/rsvp-deadline'
import { remindInvitations, sendInvitations } from '../../../invitation-actions'
import { ButtonLink, Card, Notice, buttonClass, inputClass } from '../../../../ui/kit'
import { StateBadge, personTotals, personsLine } from '../../../invitation-status'
import { loadAdminEvent, type AdminEvent } from '../event-access'
import { AddInvitationsForm, DeleteInvitationButton, EditInvitationForm } from './invitation-forms'


/**
 * Reiter "Einladungen" der Event-Seite (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): Stand pro Haushalt und Person,
 * Summen, Anlegen per Textfeld, Bearbeiten, Link und Mail pro Haushalt, Druckliste mit QR-Codes. Für alle mit
 * Zugriff auf die Gästeliste; Mails verschicken nur Owner und Admins.
 */
export default async function InvitationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gesendet?: string; erinnert?: string }> }) {
  const { id: eventId } = await params
  const { gesendet, erinnert } = await searchParams
  const loaded = await loadAdminEvent(eventId)
  if (!loaded) notFound()
  // Termin einer Reihe: die Einladungen hängen an der Reihe, hier nur der Stand für diesen Termin
  if (loaded.event.seriesId) return <TerminInvitations loaded={loaded} erinnert={erinnert} />
  const { event, isOwner: canSend } = loaded

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
  const totals = personTotals(rows.map(r => r.status))
  const unsent = invitations.filter(i => i.email && !i.sentAt).length
  const openWithEmail = rows.filter(r => r.invitation.email && r.status.state === 'open').length
  const deadline = formatDeadline(event.rsvpDeadline)

  return (
    <div className="space-y-6">
        {!event.inviteOnly && (
          <Notice tone="warning">
            Der Einladungsmodus ist für diesen Termin aus: Die Links funktionieren, aber jede*r mit dem Event-Link kann sich auch ohne Einladung anmelden. Einschalten unter „Einstellungen“ → „Zugang“ → „Nur mit Einladung“.
          </Notice>
        )}
        {erinnert !== undefined && <Notice tone="success" role="status">✅ {erinnert} Erinnerung(en) verschickt.</Notice>}
        {gesendet !== undefined && <Notice tone="success" role="status">✅ {gesendet} Einladung(en) per Mail verschickt.</Notice>}

        <Card>
          <p className="text-sm" data-testid="invitation-summary">
            <strong>{invitations.length} Haushalte</strong> ({rows.filter(r => r.status.state === 'open').length} ohne Antwort) · Personen: {totals.yes} kommen
            ({totals.adults} Erwachsene, {totals.children} Kinder, {totals.infants} Kleinkinder),
            {' '}{totals.no} kommen nicht, {totals.open} offen
            {deadline && <> · Antwortfrist: {deadline}</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canSend && unsent > 0 && (
              <form action={sendInvitations}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className={buttonClass('primary', 'sm')}>Einladungen per Mail senden ({unsent} noch nicht gesendet)</button>
              </form>
            )}
            {canSend && openWithEmail > 0 && (
              <form action={remindInvitations}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className={buttonClass('secondary', 'sm')}>⏰ Erinnerung an {openWithEmail} ohne Antwort senden</button>
              </form>
            )}
            <ButtonLink href={`/admin/einladungen/${event.id}/druck`} size="sm">🖨️ Druckliste mit QR-Codes</ButtonLink>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">Einladungen hinzufügen</h2>
          <AddInvitationsForm eventId={event.id} />
        </Card>

        {rows.length > 0 && (
          <ul className="space-y-3" data-testid="invitations">
            {rows.map(({ invitation, status, link }) => (
              <li key={invitation.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="invitation">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{invitation.label}</span>
                      <StateBadge state={status.state} />
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {personsLine(status, invitation.extraPersons)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {invitation.email ?? 'keine E-Mail'}{invitation.sentAt ? ` · Mail gesendet am ${invitation.sentAt.toLocaleDateString('de-DE')}` : ''}
                      {invitation.note ? ` · Notiz: ${invitation.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canSend && invitation.email && (
                      <form action={sendInvitations}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button type="submit" className={buttonClass('secondary', 'sm')}>{invitation.sentAt ? 'Erneut senden' : 'Senden'}</button>
                      </form>
                    )}
                    <DeleteInvitationButton invitationId={invitation.id} label={invitation.label} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input readOnly value={link} aria-label={`Link für ${invitation.label}`} className={`${inputClass} font-mono text-xs`} />
                  <a href={link} target="_blank" rel="noopener" className="whitespace-nowrap text-xs text-blue-700 hover:underline dark:text-blue-300">Antwort ansehen</a>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300">Bearbeiten</summary>
                  <EditInvitationForm invitation={{ id: invitation.id, label: invitation.label, email: invitation.email, persons: formatPersonList(invitation.persons), extraPersons: invitation.extraPersons, note: invitation.note }} />
                </details>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/**
 * Reiter "Einladungen" eines Reihen-Termins (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): Stand der Haushalte, die zu
 * diesem Termin eingeladen sind, und die Erinnerung für ihn. Anlegen und Bearbeiten auf der Seite der Reihe.
 */
async function TerminInvitations({ loaded, erinnert }: { loaded: AdminEvent; erinnert?: string }) {
  const { event, isOwner: canSend } = loaded
  const series = event.series!
  if (!event.inviteOnly && loaded.invitationCount === 0) notFound()
  const invitations = await prisma.invitation.findMany({
    where: invitationsForEvent(event),
    include: { persons: { orderBy: { position: 'asc' } }, participant: { include: { rsvps: { where: { eventId: event.id }, include: { persons: true } } } } },
    orderBy: { createdAt: 'asc' }
  })
  const rows = invitations.map(invitation => ({
    invitation,
    status: invitationStatus(invitation.persons, invitation.participant.rsvps[0] ?? null),
    link: invitationLink({ seriesSlug: series.slug, terminSlug: event.slug }, invitation.participant)
  }))
  const totals = personTotals(rows.map(r => r.status))
  const openWithEmail = rows.filter(r => r.invitation.email && r.status.state === 'open').length
  const deadline = formatDeadline(event.rsvpDeadline)

  return (
    <div className="space-y-6">
      {erinnert !== undefined && <Notice tone="success" role="status">✅ {erinnert} Erinnerung(en) verschickt.</Notice>}
      <Card>
        <p className="text-sm" data-testid="invitation-summary">
          <strong>{invitations.length} Haushalte</strong> zu diesem Termin eingeladen ({rows.filter(r => r.status.state === 'open').length} ohne Antwort) · Personen: {totals.yes} kommen
          ({totals.adults} Erwachsene, {totals.children} Kinder, {totals.infants} Kleinkinder), {totals.no} kommen nicht, {totals.open} offen
          {deadline && <> · Antwortfrist: {deadline}</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={`/admin/series/${series.id}/einladungen`} size="sm">💌 Einladungen der Reihe verwalten</ButtonLink>
          {canSend && openWithEmail > 0 && (
            <form action={remindInvitations}>
              <input type="hidden" name="eventId" value={event.id} />
              <button type="submit" className={buttonClass('secondary', 'sm')}>⏰ Erinnerung an {openWithEmail} ohne Antwort senden</button>
            </form>
          )}
        </div>
      </Card>
      {rows.length > 0 && (
        <ul className="space-y-2" data-testid="invitations">
          {rows.map(({ invitation, status, link }) => (
            <li key={invitation.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="invitation">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{invitation.label}</span>
                <StateBadge state={status.state} />
                <a href={link} target="_blank" rel="noopener" className="ml-auto text-xs text-blue-700 hover:underline dark:text-blue-300">Antwort ansehen</a>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{personsLine(status, invitation.extraPersons)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
