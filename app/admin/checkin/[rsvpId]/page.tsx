// app/admin/checkin/[rsvpId]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { checkInAtDoor, toggleAttendance, togglePersonAttendance } from '../../actions'
import { formatEuro, paymentDue, paymentState } from '../../../lib/payment-state'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { AGE_GROUP_LABEL, alcoholLabel, personsOf } from '../../../lib/persons'
import { checkInAll } from '../../../lib/checkin'

const prisma = new PrismaClient()

/**
 * Gesicherte Route, die beim Scannen des Einlass-QR-Codes geöffnet wird.
 * Schlanke, große Ansicht fürs schnelle Scannen am Handy - markiert den Gast
 * direkt beim Aufrufen der Seite als anwesend (kein zusätzlicher Klick nötig).
 * Ausnahme Abendkasse (docs/KONZEPT-TICKETS.md): Ist eine Zahlung offen, checkt die Seite NICHT ein,
 * sondern bietet "Bar kassiert - einlassen" und "Ohne Zahlung einlassen" an (checkInAtDoor).
 * Einlass pro Person (app/lib/checkin.ts): Scannen lässt alle zusagenden Personen der Antwort herein; darunter
 * steht jede Person mit Altersgruppe und Alkohol (Bändchen) und lässt sich einzeln aus- und wieder eintragen.
 */
export default async function CheckinPage({ params, searchParams }: { params: Promise<{ rsvpId: string }>; searchParams: Promise<{ ansicht?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { rsvpId } = await params
  // ?ansicht=1: nach Austragen auf dieser Seite - nur anzeigen, nicht wieder automatisch einchecken
  const viewOnly = (await searchParams).ansicht === '1'
  const load = () => prisma.rsvp.findUnique({
    where: { id: rsvpId },
    include: { participant: true, persons: { orderBy: { position: 'asc' } }, event: true, ticketCategory: { select: { label: true } } }
  })
  let rsvp = await load()

  if (!rsvp) {
    return (
      <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow max-w-sm w-full text-center">
          <span className="text-5xl block mb-4">❓</span>
          <h1 className="text-xl font-bold text-red-600">Unbekannter QR-Code</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Diese Antwort existiert nicht (mehr).</p>
        </div>
      </main>
    )
  }

  if (!(await hasEventModeratorOrAbove(user, rsvp.event))) {
    return (
      <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow max-w-sm w-full text-center">
          <span className="text-5xl block mb-4">🔒</span>
          <h1 className="text-xl font-bold text-red-600">Nicht dein Event</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Dieser QR-Code gehört zu einem Event eines anderen Kontos.</p>
        </div>
      </main>
    )
  }

  let statusIcon = '✅'
  let statusTitle = 'Eingecheckt!'
  let statusColor = 'text-green-600'
  let canUndo = false
  let collect = false

  if (!rsvp.event.enableCheckin) {
    statusIcon = '🚫'
    statusTitle = 'Check-in deaktiviert'
    statusColor = 'text-gray-500 dark:text-gray-400'
  } else if (!rsvp.isAttending) {
    statusIcon = '⚠️'
    statusTitle = 'Hat abgesagt'
    statusColor = 'text-red-600'
  } else if (rsvp.isOnWaitlist) {
    statusIcon = '⏳'
    statusTitle = 'Steht auf der Warteliste'
    statusColor = 'text-orange-600'
  } else if (paymentDue(rsvp) && !rsvp.hasAttended) {
    statusIcon = '💶'
    statusTitle = `Offen: ${formatEuro(rsvp.amountCents!)}`
    statusColor = 'text-pink-600 dark:text-pink-400'
    collect = true
  } else {
    if (!rsvp.hasAttended && !viewOnly) {
      await checkInAll(rsvp.id)
      rsvp = (await load())!
    } else if (!rsvp.hasAttended) {
      statusIcon = '⏳'
      statusTitle = 'Nicht eingecheckt'
      statusColor = 'text-gray-600 dark:text-gray-300'
    } else {
      statusTitle = 'Bereits eingecheckt'
    }
    canUndo = true
  }

  // Zusagende Personen mit ihrer Zeile (für den Haken pro Person); ohne Personenliste die Antwort selbst
  const persons = rsvp.persons.length > 0
    ? personsOf(rsvp, rsvp.participant).map((p, i) => ({ ...p, id: rsvp!.persons[i].id })).filter(p => p.isAttending)
    : personsOf(rsvp, rsvp.participant).map(p => ({ ...p, id: rsvp!.id }))
  const here = persons.filter(p => p.checkedIn).length
  if (canUndo && rsvp.hasAttended && persons.length > 1 && here < persons.length) statusTitle = `${here} von ${persons.length} da`

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow max-w-sm w-full text-center">
        <span className="text-6xl block mb-4">{statusIcon}</span>
        <h1 className={`text-2xl font-bold ${statusColor}`}>{statusTitle}</h1>
        <p className="text-xl font-medium text-gray-900 dark:text-gray-100 mt-3">{rsvp.participant.name}</p>
        {/* Personen der Antwort (docs/KONZEPT-EINLADUNGEN.md): jede mit eigenem Haken */}
        {persons.length > 1 && (
          <ul className="mt-3 space-y-2 text-left" data-testid="checkin-persons">
            {persons.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{p.checkedIn ? '✅' : '⏳'} {p.name || 'Begleitung'}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{[p.ageGroup !== 'ADULT' ? AGE_GROUP_LABEL[p.ageGroup].replace(/ \(.*\)$/, '') : null, alcoholLabel(p.drinksAlcohol)].filter(Boolean).join(' · ')}</span>
                </span>
                {canUndo && (
                  <form action={togglePersonAttendance}>
                    <input type="hidden" name="personId" value={p.id} />
                    <input type="hidden" name="back" value="checkin" />
                    <button type="submit" className="text-sm text-blue-600 hover:underline dark:text-blue-400">{p.checkedIn ? 'Austragen' : 'Einlassen'}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {persons.length === 1 && alcoholLabel(persons[0].drinksAlcohol) && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1" data-testid="checkin-alcohol">{alcoholLabel(persons[0].drinksAlcohol)}</p>
        )}
        <p className="text-gray-500 dark:text-gray-400">{rsvp.event.title}</p>

        {/* Ticket und Zahlung (Kategorie groß, damit man sie am Einlass sofort sieht) */}
        {(rsvp.ticketCategory || rsvp.amountCents) && (
          <div className="mt-5 p-4 rounded-lg border border-pink-300 bg-pink-50 dark:bg-pink-950 dark:border-pink-800" data-testid="checkin-ticket">
            {rsvp.ticketCategory && <p className="text-2xl font-bold text-pink-900 dark:text-pink-100">{rsvp.ticketCategory.label}</p>}
            {rsvp.amountCents ? (
              <p className="text-sm text-pink-700 dark:text-pink-300">
                {formatEuro(rsvp.amountCents)} · {{ paid: rsvp.paymentMethod === 'CASH' ? 'bar bezahlt' : 'bezahlt', open: 'nicht bezahlt', overdue: 'nicht bezahlt (Frist abgelaufen)', none: '', 'refund-open': 'Erstattung offen', refunded: 'erstattet' }[paymentState(rsvp)]}
              </p>
            ) : null}
          </div>
        )}

        {collect && (
          <div className="mt-6 space-y-3">
            <form action={checkInAtDoor}>
              <input type="hidden" name="rsvpId" value={rsvp.id} />
              <input type="hidden" name="mode" value="cash" />
              <button type="submit" className="w-full bg-pink-600 text-white font-bold py-3 rounded-lg hover:bg-pink-700 transition">💶 Bar kassiert - einlassen</button>
            </form>
            <form action={checkInAtDoor}>
              <input type="hidden" name="rsvpId" value={rsvp.id} />
              <input type="hidden" name="mode" value="without" />
              <button type="submit" className="w-full text-sm text-gray-600 dark:text-gray-400 underline">Ohne Zahlung einlassen</button>
            </form>
          </div>
        )}

        {/* Platz aus Seating (app/api/seating/placements) - groß, damit man ihn am Einlass sofort ansagen kann */}
        {rsvp.seatingLabel && rsvp.isAttending && !rsvp.isOnWaitlist && (
          <div className="mt-5 p-4 rounded-lg border border-lime-300 bg-lime-50 dark:bg-lime-950 dark:border-lime-800">
            <p className="text-sm text-lime-700 dark:text-lime-300">Sitzplatz</p>
            <p className="text-3xl font-bold text-lime-900 dark:text-lime-100" data-testid="seating-label">{rsvp.seatingLabel}</p>
          </div>
        )}

        {canUndo && (
          <form action={toggleAttendance} className="mt-6">
            <input type="hidden" name="rsvpId" value={rsvp.id} />
            <input type="hidden" name="back" value="checkin" />
            {rsvp.hasAttended ? (
              <button type="submit" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">
                {persons.length > 1 ? 'Alle austragen' : 'Rückgängig machen'}
              </button>
            ) : (
              <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition">{persons.length > 1 ? 'Alle einlassen' : 'Einlassen'}</button>
            )}
          </form>
        )}

        <Link href="/admin" className="block mt-8 text-sm text-blue-600 hover:underline">
          Zum Dashboard
        </Link>
      </div>
    </main>
  )
}
