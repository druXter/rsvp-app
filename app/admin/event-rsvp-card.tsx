// app/admin/event-rsvp-card.tsx
import Link from 'next/link'
import { Event, Rsvp, Participant, RsvpPerson } from '@prisma/client'
import { sendReminder, resendVerificationEmail, promoteFromWaitlist, toggleAttendance, sendPaymentReminders } from './actions'
import DeleteButton from './delete-button'
import DeleteRsvpButton from './delete-rsvp-button'
import { claimedLabels } from '../lib/bring-list'
import PaymentCell from './payment-cell'
import { formatEuro, formatPaymentDate, paymentState } from '../lib/payment-state'
import { describePerson, personsOf, seatsOf } from '../lib/persons'
import { describeSelection } from '../lib/menu'

type RsvpWithParticipant = Rsvp & { participant: Participant; persons?: (RsvpPerson & { menuChoices?: { courseId: string; option: string }[] })[]; bringClaims?: { slot: { label: string; position: number } }[] }
export type EventForCard = Event & {
  rsvps: RsvpWithParticipant[]
  bringSlots?: { label: string; quantity: number; _count: { claims: number } }[]
  ticketCategories?: { id: string; label: string; capacity: number | null }[]
  menuCourses?: { id: string; label: string }[]
}

/**
 * Eine einzelne Termin-Karte im Admin-Dashboard: Kopfzeile mit Kennzahlen/Aktionen,
 * Reminder-Formular und die vollständige Gästeliste inkl. Antworten.
 * Wird sowohl für Einzel-Events als auch für die Termine einer Reihe verwendet -
 * requireVerification kommt dabei vom jeweils zuständigen Modell (Event oder EventSeries).
 * `access` steuert, ob Owner-Aktionen (Bearbeiten/Löschen/Reminder versenden) zu sehen
 * sind - ein Moderator mit nur geteiltem Zugriff sieht ausschließlich die Gästeliste
 * und ihre Bearbeitungs-/Check-in-Aktionen.
 */
export default function EventRsvpCard({
  event,
  requireVerification,
  access = 'owner',
  ownerEmail
}: {
  event: EventForCard
  requireVerification: boolean
  access?: 'owner' | 'moderator'
  ownerEmail?: string
}) {
  const isOwner = access === 'owner'
  const attendingCount = event.rsvps.filter(r => r.isAttending).length
  const decliningCount = event.rsvps.filter(r => !r.isAttending).length
  const confirmedCount = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).length
  const checkedInCount = event.rsvps.filter(r => r.hasAttended).length
  // Begleitungen (docs/KONZEPT-EINLADUNGEN.md): Personen mit festem Platz, nur wenn es welche gibt
  const withPersons = event.maxCompanions > 0 || event.rsvps.some(r => (r.persons?.length ?? 0) > 0)
  const menuCourses = event.menuCourses ?? []
  const seatedPersons = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).reduce((sum, r) => sum + seatsOf(r.persons), 0)
  const customQuestions: string[] = event.formConfig ? (JSON.parse(event.formConfig).customQuestions || []) : []

  // Tickets und Bezahlung (docs/KONZEPT-TICKETS.md): Spalte nur, wenn der Termin Kategorien oder Beträge hat
  const categories = event.ticketCategories ?? []
  const categoryLabel = new Map(categories.map(c => [c.id, c.label]))
  const withTickets = categories.length > 0 || event.rsvps.some(r => r.amountCents)
  const now = new Date()
  const states = event.rsvps.map(r => ({ r, state: paymentState(r, now) }))
  const sum = (filter: (s: ReturnType<typeof paymentState>) => boolean) => states.filter(x => filter(x.state)).reduce((total, x) => total + (x.r.amountCents ?? 0), 0)
  const overdueCount = states.filter(x => x.state === 'overdue').length
  const refundOpenCount = states.filter(x => x.state === 'refund-open').length
  const dueCount = states.filter(x => x.state === 'open' || x.state === 'overdue').length

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-6">
      <div className="border-b pb-4 flex justify-between items-start">
        <div className="w-full">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{event.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">URL-Slug: <span className="font-mono bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1 py-0.5 rounded">/{event.slug}</span></p>
              {event.datePending && (
                <span className="inline-block mt-1 mr-1 px-2 py-0.5 bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-200 text-[10px] font-bold rounded-full">
                  📅 Datum noch offen - wird per Terminabstimmung festgelegt
                </span>
              )}
              {!isOwner && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200 text-[10px] font-bold rounded-full">
                  🔗 Für dich freigegeben{ownerEmail ? ` von ${ownerEmail}` : ''}
                </span>
              )}
              {isOwner && ownerEmail && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Eigentümer: {ownerEmail}</p>
              )}
              <div className="mt-2 flex gap-4 text-sm font-semibold">
                <span className="text-green-600">✅ Zusagen: {attendingCount}{withPersons && <span data-testid="seated-persons"> ({seatedPersons} {seatedPersons === 1 ? 'Person' : 'Personen'} mit Platz{event.maxCapacity !== null ? ` von ${event.maxCapacity}` : ''})</span>}</span>
                <span className="text-red-600">❌ Absagen: {decliningCount}</span>
                {event.enableCheckin && (
                  <span className="text-blue-600">🎫 Eingecheckt: {checkedInCount}/{confirmedCount}</span>
                )}
              </div>
            </div>

            {isOwner && (
              <div className="flex gap-2">
                <Link href={event.seriesId ? `/admin/edit-termin/${event.id}` : `/admin/edit/${event.id}`} className="px-3 py-1 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm font-medium rounded hover:bg-blue-200 dark:hover:bg-blue-900 transition">
                  ✏️ Bearbeiten
                </Link>
                <DeleteButton eventId={event.id} />
              </div>
            )}
          </div>

          {isOwner && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <details className="group">
                <summary className="cursor-pointer text-sm font-bold text-blue-600 hover:text-blue-800 transition flex items-center gap-1 list-none">
                  <span>📧 Reminder an Zusagen senden</span>
                  {event.reminderSent && <span className="text-xs text-gray-500 dark:text-gray-400 font-normal ml-2">(Erinnerung wurde bereits gesendet)</span>}
                </summary>
                <form action={sendReminder} className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="eventId" value={event.id} />
                  <textarea
                    name="customMessage"
                    rows={2}
                    className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 rounded text-sm text-gray-800 dark:text-gray-100"
                    placeholder="Optionaler Zusatztext (z.B. Infos zum Parken, Treffpunkt...)"
                  ></textarea>
                  <button
                    type="submit"
                    className="self-start bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 transition"
                  >
                    Jetzt verschicken ({attendingCount} Empfänger)
                  </button>
                </form>
              </details>
            </div>
          )}
        </div>
      </div>

      <div className="pt-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Gästeliste & Antworten</h3>
          <a
            href={`/api/export?eventId=${event.id}`}
            className="px-3 py-1 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm font-bold rounded hover:bg-green-200 dark:hover:bg-green-900 transition shadow-sm"
            download
          >
            📥 CSV Download
          </a>
        </div>

        {withTickets && (
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-3 space-y-1" data-testid="ticket-summary">
            {categories.length > 0 && (
              <p>🎟️ Tickets: {categories.map(c => {
                const taken = event.rsvps.filter(r => r.ticketCategoryId === c.id && r.isAttending && !r.isOnWaitlist).length
                return `${c.label} ${taken}${c.capacity !== null ? `/${c.capacity}` : ''}`
              }).join(' · ')}</p>
            )}
            <p>
              💶 Bezahlt {formatEuro(sum(s => s === 'paid'))} · offen {formatEuro(sum(s => s === 'open' || s === 'overdue'))}
              {overdueCount > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · {overdueCount} überfällig</span>}
              {refundOpenCount > 0 && <span className="text-amber-700 dark:text-amber-400 font-semibold"> · {refundOpenCount} Erstattung offen</span>}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/admin/zahlungen/${event.id}`} className="px-2 py-1 text-xs font-medium rounded border border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 hover:bg-pink-100 dark:hover:bg-pink-900 transition">
                📄 Kontoauszug abgleichen
              </Link>
              {isOwner && dueCount > 0 && (
                <form action={sendPaymentReminders}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <button type="submit" className="px-2 py-1 text-xs font-medium rounded border border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 hover:bg-pink-100 dark:hover:bg-pink-900 transition">
                    💶 Zahlungserinnerung an {dueCount} offene senden
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {(withPersons || menuCourses.length > 0) && (
          <p className="text-sm mb-3">
            <Link href={`/admin/kueche/${event.id}`} className="px-2 py-1 text-xs font-medium rounded border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900 transition">
              🍽️ Küchenübersicht{menuCourses.length > 0 ? ' (Menü, Allergien)' : ' (Essen, Allergien)'}
            </Link>
          </p>
        )}

        {event.bringSlots && event.bringSlots.length > 0 && (
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3" data-testid="bring-summary">
            🍕 Mitbringliste: {event.bringSlots.map(s => `${s.label} ${s._count.claims}/${s.quantity}`).join(' · ')}
          </p>
        )}

        {event.rsvps.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">Bisher noch keine Antworten eingegangen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-max">
              <thead>
                <tr className="border-b bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  <th className="p-2">Name</th>
                  <th className="p-2">Status</th>
                  {withTickets && <th className="p-2">Ticket / Zahlung</th>}
                  <th className="p-2">E-Mail</th>
                  <th className="p-2">Handy</th>
                  <th className="p-2">Begleitungen</th>
                  {menuCourses.length > 0 && <th className="p-2">Menü</th>}
                  <th className="p-2">Essen</th>
                  <th className="p-2">Allergien</th>
                  <th className="p-2">Alkohol</th>
                  <th className="p-2">Mitbringsel</th>
                  <th className="p-2">Anmerkungen / Grund</th>
                  {customQuestions.map((q, i) => <th key={i} className="p-2">{q}</th>)}
                  {event.enableCheckin && <th className="p-2">Check-in</th>}
                  <th className="p-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {event.rsvps.map(rsvp => (
                  <tr key={rsvp.id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="p-2 font-medium text-gray-900 dark:text-gray-100">{rsvp.participant.name}</td>
                    <td className="p-2">
                      {rsvp.isAttending ? (
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-bold">Kommt</span>
                          {rsvp.isOnWaitlist && (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-200 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                Warteliste
                              </span>
                              <form action={promoteFromWaitlist}>
                                <input type="hidden" name="rsvpId" value={rsvp.id} />
                                <button
                                  type="submit"
                                  className="text-[10px] text-green-600 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200 transition flex items-center gap-1 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-800"
                                  title="Diesen Gast manuell fest eintragen (ignoriert Limit)"
                                >
                                  ✅ Zulassen
                                </button>
                              </form>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-red-500 font-bold">Abgesagt</span>
                      )}
                    </td>

                    {withTickets && (
                      <td className="p-2 text-xs">
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

                    <td className="p-2 text-gray-600 dark:text-gray-400">
                      <div className="flex flex-col items-start gap-1">
                        <span>{rsvp.participant.email || '-'}</span>
                        {rsvp.participant.email && (
                          <>
                            {requireVerification && !rsvp.participant.isVerified && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="inline-block px-2 py-0.5 bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 text-[10px] font-bold rounded-full" title="Wartet auf Klick in der E-Mail">
                                  🟡 Ausstehend
                                </span>
                                <form action={resendVerificationEmail}>
                                  <input type="hidden" name="rsvpId" value={rsvp.id} />
                                  <button
                                    type="submit"
                                    className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline transition"
                                    title="Verifizierungs-Mail erneut senden"
                                  >
                                    ✉️ Erneut senden
                                  </button>
                                </form>
                              </div>
                            )}
                            {rsvp.participant.isVerified && (
                              <span className="inline-block px-2 py-0.5 bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 text-[10px] font-bold rounded-full" title={rsvp.participant.verifiedAt ? `Bestätigt am ${rsvp.participant.verifiedAt.toLocaleDateString('de-DE')}` : 'Verifiziert'}>
                                🟢 Verifiziert
                              </span>
                            )}
                            {!requireVerification && !rsvp.participant.isVerified && (
                              <span className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-[10px] font-bold rounded-full" title="Dieser Termin erfordert keine Verifizierung">
                                ⚪ Ohne Prüfung
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>

                    <td className="p-2 text-gray-600 dark:text-gray-400">{rsvp.participant.phone || '-'}</td>

                    <td className="p-2 text-gray-600 dark:text-gray-400">
                      {personsOf(rsvp, rsvp.participant).slice(1).map(p => describePerson(p)).join('; ') || '-'}
                    </td>

                    {menuCourses.length > 0 && (
                      <td className="p-2 text-gray-600 dark:text-gray-400 text-xs">
                        {rsvp.isAttending
                          ? personsOf(rsvp, rsvp.participant).filter(p => p.isAttending && p.ageGroup !== 'INFANT').map(p => `${p.name || 'Begleitung'}: ${describeSelection(menuCourses, p.menu) || 'offen'}`).join('; ')
                          : '-'}
                      </td>
                    )}

                    <td className="p-2 text-gray-600 dark:text-gray-400">{rsvp.participant.dietaryOption || '-'}</td>

                    <td className="p-2 text-gray-600 dark:text-gray-400">{rsvp.participant.allergies || '-'}</td>

                    <td className="p-2 text-gray-600 dark:text-gray-400">
                      {rsvp.drinksAlcohol === true ? 'Ja' : rsvp.drinksAlcohol === false ? 'Nein' : '-'}
                    </td>

                    <td className="p-2 text-gray-600 dark:text-gray-400">{[...claimedLabels(rsvp), ...(rsvp.bringingItem ? [rsvp.bringingItem] : [])].join(', ') || '-'}</td>

                    <td className="p-2 text-gray-500 dark:text-gray-400">
                      {rsvp.isAttending
                        ? (rsvp.additionalInfo || '-')
                        : (rsvp.declineReason || '-')}
                    </td>

                    {customQuestions.map((_, i) => {
                      const answers: string[] = rsvp.customAnswers ? JSON.parse(rsvp.customAnswers) : []
                      return <td key={i} className="p-2 text-gray-600 dark:text-gray-400">{answers[i] || '-'}</td>
                    })}

                    {event.enableCheckin && (
                      <td className="p-2">
                        {rsvp.isAttending && !rsvp.isOnWaitlist ? (
                          <form action={toggleAttendance}>
                            <input type="hidden" name="rsvpId" value={rsvp.id} />
                            <button
                              type="submit"
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition ${
                                rsvp.hasAttended
                                  ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800 hover:bg-blue-200 dark:hover:bg-blue-900'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                              title={rsvp.checkedInAt ? `Eingecheckt am ${rsvp.checkedInAt.toLocaleString('de-DE')}` : 'Noch nicht eingecheckt - hier klicken zum manuellen Einchecken'}
                            >
                              {rsvp.hasAttended ? '🎫 Da' : '⬜ Nicht da'}
                            </button>
                          </form>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                    )}

                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/admin/edit-rsvp/${rsvp.id}`}
                          className="px-2 py-1 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-bold rounded hover:bg-blue-200 dark:hover:bg-blue-900 transition"
                          title="Antwort bearbeiten"
                        >
                          ✏️
                        </Link>
                        <DeleteRsvpButton rsvpId={rsvp.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
