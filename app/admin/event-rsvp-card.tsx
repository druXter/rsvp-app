// app/admin/event-rsvp-card.tsx
import Link from 'next/link'
import { Event, Rsvp, Participant } from '@prisma/client'
import { sendReminder, resendVerificationEmail, promoteFromWaitlist, toggleAttendance } from './actions'
import DeleteButton from './delete-button'
import DeleteRsvpButton from './delete-rsvp-button'

type RsvpWithParticipant = Rsvp & { participant: Participant }
export type EventForCard = Event & { rsvps: RsvpWithParticipant[] }

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
  const customQuestions: string[] = event.formConfig ? (JSON.parse(event.formConfig).customQuestions || []) : []

  return (
    <div className="bg-white p-6 rounded-lg shadow mb-6">
      <div className="border-b pb-4 flex justify-between items-start">
        <div className="w-full">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{event.title}</h2>
              <p className="text-sm text-gray-500">URL-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/{event.slug}</span></p>
              {!isOwner && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-teal-100 text-teal-800 text-[10px] font-bold rounded-full">
                  🔗 Für dich freigegeben{ownerEmail ? ` von ${ownerEmail}` : ''}
                </span>
              )}
              {isOwner && ownerEmail && (
                <p className="text-xs text-gray-400 mt-1">Eigentümer: {ownerEmail}</p>
              )}
              <div className="mt-2 flex gap-4 text-sm font-semibold">
                <span className="text-green-600">✅ Zusagen: {attendingCount}</span>
                <span className="text-red-600">❌ Absagen: {decliningCount}</span>
                {event.enableCheckin && (
                  <span className="text-blue-600">🎫 Eingecheckt: {checkedInCount}/{confirmedCount}</span>
                )}
              </div>
            </div>

            {isOwner && (
              <div className="flex gap-2">
                <Link href={event.seriesId ? `/admin/edit-termin/${event.id}` : `/admin/edit/${event.id}`} className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded hover:bg-blue-200 transition">
                  ✏️ Bearbeiten
                </Link>
                <DeleteButton eventId={event.id} />
              </div>
            )}
          </div>

          {isOwner && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <details className="group">
                <summary className="cursor-pointer text-sm font-bold text-blue-600 hover:text-blue-800 transition flex items-center gap-1 list-none">
                  <span>📧 Reminder an Zusagen senden</span>
                  {event.reminderSent && <span className="text-xs text-gray-500 font-normal ml-2">(Erinnerung wurde bereits gesendet)</span>}
                </summary>
                <form action={sendReminder} className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="eventId" value={event.id} />
                  <textarea
                    name="customMessage"
                    rows={2}
                    className="w-full border border-gray-300 p-2 rounded text-sm text-gray-800"
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
          <h3 className="font-bold text-gray-900">Gästeliste & Antworten</h3>
          <a
            href={`/api/export?eventId=${event.id}`}
            className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded hover:bg-green-200 transition shadow-sm"
            download
          >
            📥 CSV Download
          </a>
        </div>

        {event.rsvps.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Bisher noch keine Antworten eingegangen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-max">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-700">
                  <th className="p-2">Name</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">E-Mail</th>
                  <th className="p-2">Handy</th>
                  <th className="p-2">Begleitung</th>
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
                  <tr key={rsvp.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-2 font-medium text-gray-900">{rsvp.participant.name}</td>
                    <td className="p-2">
                      {rsvp.isAttending ? (
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-bold">Kommt</span>
                          {rsvp.isOnWaitlist && (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="bg-orange-100 text-orange-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                Warteliste
                              </span>
                              <form action={promoteFromWaitlist}>
                                <input type="hidden" name="rsvpId" value={rsvp.id} />
                                <button
                                  type="submit"
                                  className="text-[10px] text-green-600 hover:text-green-800 transition flex items-center gap-1 bg-green-50 px-1.5 py-0.5 rounded border border-green-200"
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

                    <td className="p-2 text-gray-600">
                      <div className="flex flex-col items-start gap-1">
                        <span>{rsvp.participant.email || '-'}</span>
                        {rsvp.participant.email && (
                          <>
                            {requireVerification && !rsvp.participant.isVerified && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="inline-block px-2 py-0.5 bg-yellow-100 text-yellow-800 text-[10px] font-bold rounded-full" title="Wartet auf Klick in der E-Mail">
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
                              <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold rounded-full" title={rsvp.participant.verifiedAt ? `Bestätigt am ${rsvp.participant.verifiedAt.toLocaleDateString('de-DE')}` : 'Verifiziert'}>
                                🟢 Verifiziert
                              </span>
                            )}
                            {!requireVerification && !rsvp.participant.isVerified && (
                              <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-full" title="Dieser Termin erfordert keine Verifizierung">
                                ⚪ Ohne Prüfung
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>

                    <td className="p-2 text-gray-600">{rsvp.participant.phone || '-'}</td>

                    <td className="p-2 text-gray-600">
                      {rsvp.plusOne
                        ? `Ja ${rsvp.plusOneName ? '(' + rsvp.plusOneName + ')' : ''}`
                        : '-'}
                    </td>

                    <td className="p-2 text-gray-600">{rsvp.participant.dietaryOption || '-'}</td>

                    <td className="p-2 text-gray-600">{rsvp.participant.allergies || '-'}</td>

                    <td className="p-2 text-gray-600">
                      {rsvp.drinksAlcohol === true ? 'Ja' : rsvp.drinksAlcohol === false ? 'Nein' : '-'}
                    </td>

                    <td className="p-2 text-gray-600">{rsvp.bringingItem || '-'}</td>

                    <td className="p-2 text-gray-500">
                      {rsvp.isAttending
                        ? (rsvp.additionalInfo || '-')
                        : (rsvp.declineReason || '-')}
                    </td>

                    {customQuestions.map((_, i) => {
                      const answers: string[] = rsvp.customAnswers ? JSON.parse(rsvp.customAnswers) : []
                      return <td key={i} className="p-2 text-gray-600">{answers[i] || '-'}</td>
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
                                  ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
                                  : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                              }`}
                              title={rsvp.checkedInAt ? `Eingecheckt am ${rsvp.checkedInAt.toLocaleString('de-DE')}` : 'Noch nicht eingecheckt - hier klicken zum manuellen Einchecken'}
                            >
                              {rsvp.hasAttended ? '🎫 Da' : '⬜ Nicht da'}
                            </button>
                          </form>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    )}

                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/admin/edit-rsvp/${rsvp.id}`}
                          className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded hover:bg-blue-200 transition"
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
