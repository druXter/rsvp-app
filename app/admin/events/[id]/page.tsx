// app/admin/events/[id]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { summarizeEvent } from '../../../lib/event-summary'
import { presentPersons } from '../../../lib/checkin'
import { formatEuro } from '../../../lib/payment-state'
import { baseUrl } from '../../../lib/base-url'
import { formatDeadline, deadlinePassed } from '../../../lib/rsvp-deadline'
import { DATE_PENDING_TEXT } from '../../../lib/event-date'
import { sendPaymentReminders, sendReminder } from '../../actions'
import { Badge, ButtonLink, Card, Notice, Stat, buttonClass, inputClass } from '../../../ui/kit'
import { guestPageOf, loadAdminEvent } from './event-access'
import { invitationsForEvent } from '../../../lib/invitation-store'

/**
 * Reiter "Übersicht" (docs/KONZEPT-OBERFLAECHE.md): Kennzahlen, Hinweise (Frist, Datum offen, ungesendete
 * Einladungen) und die Aktionen zum ganzen Event - Link für Gäste, CSV, Erinnerung an alle Zusagen,
 * Zahlungserinnerung. Erinnerungen verschicken nur Owner und Admins.
 */
export default async function EventOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event, isOwner, invitationCount } = loaded

  const [rsvps, categories, bringSlots, unsentInvitations] = await Promise.all([
    prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: {
        isAttending: true, isOnWaitlist: true, hasAttended: true, leftAt: true, amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true, ticketCategoryId: true,
        persons: { select: { isAttending: true, ageGroup: true, checkedInAt: true, leftAt: true } }
      }
    }),
    prisma.ticketCategory.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } }),
    prisma.bringSlot.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' }, include: { _count: { select: { claims: true } } } }),
    event.inviteOnly ? prisma.invitation.count({ where: { AND: [invitationsForEvent(event), { email: { not: null }, sentAt: null }] } }) : Promise.resolve(0)
  ])
  const s = summarizeEvent(rsvps, event.inviteOnly ? invitationCount : null)
  const link = `${baseUrl()}${guestPageOf(event)}`
  const deadline = formatDeadline(event.rsvpDeadline)
  const base = `/admin/events/${event.id}`

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-stats">
        <Stat
          label="Zusagen" testId="stat-confirmed" tone="green"
          value={s.confirmed}
          hint={<>{s.seats !== s.confirmed ? `${s.seats} Personen` : ''}{event.maxCapacity !== null ? `${s.seats !== s.confirmed ? ' · ' : ''}${s.seats} von ${event.maxCapacity} Plätzen` : ''}</>}
          progress={event.maxCapacity !== null ? { value: s.seats, max: event.maxCapacity } : null}
        />
        <Stat label="Warteliste" value={s.waitlist} tone={s.waitlist > 0 ? 'orange' : undefined} testId="stat-waitlist" />
        <Stat label="Absagen" value={s.declined} testId="stat-declined" />
        {s.invitationsOpen !== null
          ? <Stat label="Einladungen ohne Antwort" value={s.invitationsOpen} hint={`von ${invitationCount} Haushalten`} testId="stat-invitations" />
          : event.enableCheckin
            ? event.trackPresence
              ? <Stat label="Jetzt da" value={`${presentPersons(rsvps)}/${s.attendees}`} hint={`Personen · ${s.checkedIn} da gewesen`} testId="stat-checkin" />
              : <Stat label="Eingecheckt" value={`${s.checkedIn}/${s.attendees}`} hint="Personen" testId="stat-checkin" />
            : <Stat label="Antworten" value={rsvps.length} />}
      </div>

      {(event.datePending || deadline || unsentInvitations > 0) && (
        <div className="space-y-2">
          {event.datePending && <Notice tone="info">📅 {DATE_PENDING_TEXT} - das Datum wird per Terminabstimmung festgelegt.</Notice>}
          {deadline && <Notice tone={deadlinePassed(event) ? 'warning' : 'info'}>⏰ Antwortfrist: {deadline}{deadlinePassed(event) ? ' - abgelaufen, nur noch ihr könnt Antworten ändern.' : ''}</Notice>}
          {unsentInvitations > 0 && (
            <Notice tone="warning">💌 {unsentInvitations} Einladung(en) mit E-Mail sind noch nicht verschickt. <a href={`${base}/einladungen`} className="font-medium underline">Zu den Einladungen</a></Notice>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Link für Gäste</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {event.inviteOnly ? 'Nur mit Einladung: Gäste brauchen ihren persönlichen Link aus der Einladung. Ohne ihn zeigt die Seite nur den Titel.' : 'Diesen Link verschickt ihr an die Gäste (oder bindet ihn ein).'}
          </p>
          <input readOnly value={link} aria-label="Link für Gäste" className={`${inputClass} mt-3 font-mono text-xs`} />
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href={guestPageOf(event)} external size="sm">Öffnen ↗</ButtonLink>
            <a href={`/api/export?eventId=${event.id}`} download className={buttonClass('secondary', 'sm')}>📥 Gästeliste als CSV</a>
          </div>
        </Card>

        {isOwner && (
          <Card>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Erinnerung an alle Zusagen</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {event.autoReminder ? `Automatisch ${event.reminderDays} Tage vorher. ` : ''}{event.reminderSent ? 'Wurde bereits verschickt.' : 'Per Mail und Push an alle mit Zusage.'}
            </p>
            <form action={sendReminder} className="mt-3 space-y-2">
              <input type="hidden" name="eventId" value={event.id} />
              <textarea name="customMessage" rows={2} className={inputClass} placeholder="Optionaler Zusatztext (z.B. Infos zum Parken, Treffpunkt…)" />
              <button type="submit" className={buttonClass('secondary', 'sm')}>Jetzt an {s.confirmed + s.waitlist} senden</button>
            </form>
          </Card>
        )}

        {categories.length > 0 && (
          <Card>
            <div data-testid="ticket-summary">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Tickets und Zahlungen</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {categories.map(c => {
                const taken = rsvps.filter(r => r.ticketCategoryId === c.id && r.isAttending && !r.isOnWaitlist).length
                return <li key={c.id} className="flex justify-between"><span>{c.label} ({formatEuro(c.priceCents)})</span><span className="text-gray-600 dark:text-gray-400">{taken}{c.capacity !== null ? ` / ${c.capacity}` : ''}</span></li>
              })}
            </ul>
            <p className="mt-3 text-sm">
              Bezahlt {formatEuro(s.paidCents)} · offen {formatEuro(s.openCents)}
              {s.paymentsOverdue > 0 && <> · <Badge tone="red">{s.paymentsOverdue} überfällig</Badge></>}
            </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={`${base}/zahlungen`} size="sm">📄 Kontoauszug abgleichen</ButtonLink>
              {isOwner && s.paymentsOpen > 0 && (
                <form action={sendPaymentReminders}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <button type="submit" className={buttonClass('secondary', 'sm')}>Zahlungserinnerung an {s.paymentsOpen} offene senden</button>
                </form>
              )}
            </div>
          </Card>
        )}

        {bringSlots.length > 0 && (
          <Card>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Mitbringliste</h2>
            <ul className="mt-2 space-y-1 text-sm" data-testid="bring-summary">
              {bringSlots.map(slot => (
                <li key={slot.id} className="flex justify-between">
                  <span>{slot.label}</span>
                  <span className={slot._count.claims >= slot.quantity ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>{slot._count.claims}/{slot.quantity}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
