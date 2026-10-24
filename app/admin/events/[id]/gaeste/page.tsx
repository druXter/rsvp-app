// app/admin/events/[id]/gaeste/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { claimedLabels } from '../../../../lib/bring-list'
import { formatEuro, formatPaymentDate, paymentState } from '../../../../lib/payment-state'
import { alcoholLabel, describePerson, personDetails, personsOf } from '../../../../lib/persons'
import { describeSelection } from '../../../../lib/menu'
import { isPresent } from '../../../../lib/checkin'
import { promoteFromWaitlist, resendVerificationEmail, toggleAttendance, togglePersonAttendance } from '../../../actions'
import DeleteRsvpButton from '../../../delete-rsvp-button'
import PaymentCell from '../../../payment-cell'
import { Badge, EmptyState, buttonClass, inputClass } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'

const FILTERS = [
  { key: 'alle', label: 'Alle' },
  { key: 'zusagen', label: 'Zusagen' },
  { key: 'warteliste', label: 'Warteliste' },
  { key: 'absagen', label: 'Absagen' },
  { key: 'zahlung-offen', label: 'Zahlung offen' }
] as const

/**
 * Reiter "Gäste" (docs/KONZEPT-OBERFLAECHE.md): kompakte Liste mit Filter und Suche. Pro Antwort Name, Personen,
 * Status, je nach Event Ticket/Zahlung, Menü und Check-in, dazu Bearbeiten/Löschen. Alle übrigen Angaben (Kontakt,
 * Essen, Alkohol, Mitbringsel, Anmerkungen, Zusatzfragen, Platz) stehen aufklappbar unter "Details". Auf dem Handy
 * werden die Zeilen zu Karten.
 */
export default async function EventGuests({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filter?: string; q?: string }> }) {
  const { id } = await params
  const { filter: rawFilter, q: rawQuery } = await searchParams
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event } = loaded

  const [rsvps, categories, menuCourses] = await Promise.all([
    prisma.rsvp.findMany({
      where: { eventId: event.id },
      include: {
        participant: true,
        persons: { include: { menuChoices: true } },
        bringClaims: { select: { slot: { select: { label: true, position: true } } } }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.ticketCategory.findMany({ where: { eventId: event.id }, select: { id: true, label: true } }),
    prisma.menuCourse.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' }, select: { id: true, label: true } })
  ])

  const config = event.formConfig ? JSON.parse(event.formConfig) : {}
  const customQuestions: string[] = config.customQuestions || []
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const withTickets = categories.length > 0 || rsvps.some(r => r.amountCents)
  const categoryLabel = new Map(categories.map(c => [c.id, c.label]))
  const now = new Date()

  const matches: Record<(typeof FILTERS)[number]['key'], (r: (typeof rsvps)[number]) => boolean> = {
    alle: () => true,
    zusagen: r => r.isAttending && !r.isOnWaitlist,
    warteliste: r => r.isAttending && r.isOnWaitlist,
    absagen: r => !r.isAttending,
    'zahlung-offen': r => ['open', 'overdue'].includes(paymentState(r, now))
  }
  const filter = FILTERS.find(f => f.key === rawFilter && (f.key !== 'zahlung-offen' || withTickets))?.key ?? 'alle'
  const query = (rawQuery ?? '').trim().toLowerCase().slice(0, 100)
  const shown = rsvps.filter(matches[filter]).filter(r => !query || [r.participant.name, r.participant.email ?? '', ...r.persons.map(p => p.name ?? '')].some(v => v.toLowerCase().includes(query)))
  const href = (key: string) => `/admin/events/${event.id}/gaeste${key === 'alle' ? '' : `?filter=${key}`}`

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <nav className="flex flex-wrap gap-1" aria-label="Filter">
          {FILTERS.filter(f => f.key !== 'zahlung-offen' || withTickets).map(f => {
            const count = rsvps.filter(matches[f.key]).length
            const active = f.key === filter
            return (
              <Link key={f.key} href={href(f.key)} aria-current={active ? 'page' : undefined}
                className={`rounded-full px-3 py-1 text-sm ${active ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}`}>
                {f.label} <span className="opacity-70">{count}</span>
              </Link>
            )
          })}
        </nav>
        <div className="flex gap-2">
          <form className="flex gap-2" role="search">
            {filter !== 'alle' && <input type="hidden" name="filter" value={filter} />}
            <input name="q" defaultValue={rawQuery ?? ''} placeholder="Name oder E-Mail suchen" aria-label="Gäste suchen" className={`${inputClass} md:w-56`} />
          </form>
          <a href={`/api/export?eventId=${event.id}`} download className={buttonClass('secondary')}>📥 CSV</a>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState>{rsvps.length === 0 ? 'Bisher noch keine Antworten.' : 'Keine Antworten für diesen Filter.'}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-left text-sm" data-testid="guest-table">
            <thead className="hidden bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400 md:table-header-group">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {withTickets && <th className="px-4 py-2 font-medium">Ticket / Zahlung</th>}
                {menuCourses.length > 0 && <th className="px-4 py-2 font-medium">Menü</th>}
                {event.enableCheckin && <th className="px-4 py-2 font-medium">Einlass</th>}
                <th className="px-4 py-2 font-medium text-right"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {shown.map(rsvp => {
                const persons = personsOf(rsvp, rsvp.participant)
                const others = event.inviteOnly ? persons : persons.slice(1)
                const answers: string[] = rsvp.customAnswers ? JSON.parse(rsvp.customAnswers) : []
                const bring = [...claimedLabels(rsvp), ...(rsvp.bringingItem ? [rsvp.bringingItem] : [])]
                return (
                  <tr key={rsvp.id} className="block p-4 md:table-row md:p-0" data-testid="guest-row">
                    <td className="block md:table-cell md:px-4 md:py-3 align-top">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {rsvp.participant.name}
                        {rsvp.shiftHelperId && <> <Badge tone="green">Helfer*in · {rsvp.shiftCount === 1 ? '1 Schicht' : `${rsvp.shiftCount ?? 0} Schichten`}</Badge></>}
                      </div>
                      {others.length > 0 && (
                        <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400" data-testid="guest-persons">
                          {event.inviteOnly
                            ? others.map(p => `${p.isAttending ? '✓' : '✗'} ${describePerson(p)}`).join('; ')
                            : `+ ${others.map(p => describePerson(p)).join('; ')}`}
                        </div>
                      )}
                      {rsvp.participant.email && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{rsvp.participant.email}</div>}
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-blue-700 hover:underline dark:text-blue-300">Details</summary>
                        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-gray-700 dark:text-gray-300">
                          <dt className="text-gray-500">E-Mail</dt>
                          <dd className="flex flex-wrap items-center gap-2">
                            {rsvp.participant.email || '-'}
                            {rsvp.participant.email && requireVerification && !rsvp.participant.isVerified && (
                              <>
                                <Badge tone="amber">Bestätigung ausstehend</Badge>
                                <form action={resendVerificationEmail}>
                                  <input type="hidden" name="rsvpId" value={rsvp.id} />
                                  <button type="submit" className="text-blue-700 hover:underline dark:text-blue-300">erneut senden</button>
                                </form>
                              </>
                            )}
                            {rsvp.participant.isVerified && <Badge tone="green">bestätigt</Badge>}
                          </dd>
                          <dt className="text-gray-500">Handy</dt><dd>{rsvp.participant.phone || '-'}</dd>
                          {persons.map((p, i) => (
                            <PersonDetails key={i} label={event.inviteOnly || i > 0 ? (p.name || 'Begleitung') : 'Angaben'} value={[[...personDetails(p), alcoholLabel(p.drinksAlcohol)].filter(Boolean).join(', ') || '-', menuCourses.length > 0 && p.isAttending && p.ageGroup !== 'INFANT' ? describeSelection(menuCourses, p.menu) || 'Menü offen' : null].filter(Boolean).join(' · ')} />
                          ))}
                          {bring.length > 0 && <><dt className="text-gray-500">Mitbringsel</dt><dd>{bring.join(', ')}</dd></>}
                          {(rsvp.isAttending ? rsvp.additionalInfo : rsvp.declineReason) && <><dt className="text-gray-500">{rsvp.isAttending ? 'Anmerkungen' : 'Grund'}</dt><dd className="whitespace-pre-line">{rsvp.isAttending ? rsvp.additionalInfo : rsvp.declineReason}</dd></>}
                          {customQuestions.map((q, i) => answers[i] ? <QuestionAnswer key={i} question={q} answer={answers[i]} /> : null)}
                          {rsvp.seatingLabel && <><dt className="text-gray-500">Platz</dt><dd>{rsvp.seatingLabel}</dd></>}
                          <dt className="text-gray-500">Geantwortet</dt><dd>{rsvp.createdAt.toLocaleDateString('de-DE')}</dd>
                        </dl>
                      </details>
                    </td>
                    <td className="mt-2 block md:mt-0 md:table-cell md:px-4 md:py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        {!rsvp.isAttending ? <Badge tone="red">Abgesagt</Badge> : rsvp.isOnWaitlist ? <Badge tone="orange">Warteliste</Badge> : <Badge tone="green">Kommt</Badge>}
                        {rsvp.isAttending && rsvp.isOnWaitlist && (
                          <form action={promoteFromWaitlist}>
                            <input type="hidden" name="rsvpId" value={rsvp.id} />
                            <button type="submit" className={buttonClass('secondary', 'sm')} title="Fest eintragen, auch über die Kapazität hinaus">Zulassen</button>
                          </form>
                        )}
                      </div>
                    </td>
                    {withTickets && (
                      <td className="mt-2 block text-xs md:mt-0 md:table-cell md:px-4 md:py-3 align-top">
                        <PaymentCell
                          rsvpId={rsvp.id}
                          state={paymentState(rsvp, now)}
                          categoryLabel={rsvp.ticketCategoryId ? categoryLabel.get(rsvp.ticketCategoryId) ?? null : null}
                          amount={rsvp.amountCents ? formatEuro(rsvp.amountCents) : null}
                          reference={rsvp.paymentReference}
                          paidAt={rsvp.paidAt ? formatPaymentDate(rsvp.paidAt) : null}
                          method={rsvp.paymentMethod}
                          dueAt={rsvp.paymentDueAt ? formatPaymentDate(rsvp.paymentDueAt) : null}
                        />
                      </td>
                    )}
                    {menuCourses.length > 0 && (
                      <td className={`mt-2 text-xs text-gray-700 dark:text-gray-300 md:mt-0 md:table-cell md:px-4 md:py-3 align-top ${rsvp.isAttending ? 'block' : 'hidden'}`} data-testid="guest-menu">
                        {rsvp.isAttending
                          ? persons.filter(p => p.isAttending && p.ageGroup !== 'INFANT').map(p => `${p.name || 'Begleitung'}: ${describeSelection(menuCourses, p.menu) || 'offen'}`).join('; ')
                          : '-'}
                      </td>
                    )}
                    {event.enableCheckin && (
                      <td className={`mt-2 md:mt-0 md:table-cell md:px-4 md:py-3 align-top ${rsvp.isAttending && !rsvp.isOnWaitlist ? 'block' : 'hidden'}`} data-testid="guest-checkin">
                        {rsvp.isAttending && !rsvp.isOnWaitlist ? (
                          <CheckinCell rsvp={rsvp} persons={persons} tracked={event.trackPresence} />
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    <td className="mt-3 block md:mt-0 md:table-cell md:px-4 md:py-3 align-top md:text-right">
                      <div className="flex gap-2 md:justify-end">
                        <Link href={`/admin/edit-rsvp/${rsvp.id}`} className={buttonClass('secondary', 'sm')} title="Antwort bearbeiten" aria-label={`Antwort von ${rsvp.participant.name} bearbeiten`}>✏️</Link>
                        <DeleteRsvpButton rsvpId={rsvp.id} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Einlass in der Gästeliste (app/lib/checkin.ts): ein Knopf für die ganze Antwort, bei mehreren Personen darunter
 * jede einzeln ("später gekommen", "doch nicht da"). Mit Kommen und Gehen (`tracked`) geht, wer da ist, und wer
 * gegangen ist, steht mit Uhrzeit da und kommt per Klick wieder.
 */
function CheckinCell({ rsvp, persons, tracked }: { rsvp: { id: string; hasAttended: boolean; checkedInAt: Date | null; leftAt: Date | null; persons: { id: string; position: number }[] }; persons: ReturnType<typeof personsOf>; tracked: boolean }) {
  const rows = [...rsvp.persons].sort((a, b) => a.position - b.position)
  const attending = persons.map((p, i) => ({ ...p, id: rows[i]?.id })).filter(p => p.isAttending && p.id)
  const here = attending.filter(p => p.checkedIn).length
  const present = isPresent(rsvp)
  const time = (d: Date) => d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
  const label = present
    ? `🎫 Da${attending.length > 1 ? ` ${here}/${attending.length}` : ''}`
    : rsvp.hasAttended && rsvp.leftAt ? `🚪 Weg seit ${time(rsvp.leftAt)}` : 'Nicht da'
  const title = present
    ? (tracked ? 'Geht - auschecken' : `Eingecheckt am ${rsvp.checkedInAt!.toLocaleString('de-DE')}`)
    : rsvp.hasAttended ? 'Kommt wieder - einchecken' : 'Alle einchecken'
  return (
    <div className="space-y-1">
      <form action={toggleAttendance}>
        <input type="hidden" name="rsvpId" value={rsvp.id} />
        <button type="submit" className={buttonClass(present ? 'primary' : 'secondary', 'sm')} title={title}>
          {label}
        </button>
      </form>
      {attending.length > 1 && (
        <ul className="space-y-0.5 text-xs" data-testid="checkin-persons">
          {attending.map(p => (
            <li key={p.id}>
              <form action={togglePersonAttendance}>
                <input type="hidden" name="personId" value={p.id} />
                <button type="submit" className="text-left hover:underline" aria-label={`${p.name || 'Begleitung'} ${p.checkedIn ? (tracked ? 'geht' : 'austragen') : 'einchecken'}`}>
                  {p.checkedIn ? '✓' : p.left ? '🚪' : '○'} {p.name || 'Begleitung'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonDetails({ label, value }: { label: string; value: string }) {
  return <><dt className="text-gray-500">{label}</dt><dd>{value}</dd></>
}

function QuestionAnswer({ question, answer }: { question: string; answer: string }) {
  return <><dt className="text-gray-500">{question}</dt><dd>{answer}</dd></>
}
