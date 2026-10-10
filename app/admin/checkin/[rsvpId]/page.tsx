// app/admin/checkin/[rsvpId]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { checkInAtDoor, toggleAttendance } from '../../actions'
import { formatEuro, paymentDue, paymentState } from '../../../lib/payment-state'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { attendingNames, personsOf } from '../../../lib/persons'

const prisma = new PrismaClient()

/**
 * Gesicherte Route, die beim Scannen des Einlass-QR-Codes geöffnet wird.
 * Schlanke, große Ansicht fürs schnelle Scannen am Handy - markiert den Gast
 * direkt beim Aufrufen der Seite als anwesend (kein zusätzlicher Klick nötig).
 * Ausnahme Abendkasse (docs/KONZEPT-TICKETS.md): Ist eine Zahlung offen, checkt die Seite NICHT ein,
 * sondern bietet "Bar kassiert - einlassen" und "Ohne Zahlung einlassen" an (checkInAtDoor).
 */
export default async function CheckinPage({ params }: { params: Promise<{ rsvpId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { rsvpId } = await params
  const rsvp = await prisma.rsvp.findUnique({
    where: { id: rsvpId },
    include: { participant: true, persons: true, event: true, ticketCategory: { select: { label: true } } }
  })

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
    if (!rsvp.hasAttended) {
      await prisma.rsvp.update({ where: { id: rsvp.id }, data: { hasAttended: true, checkedInAt: new Date() } })
    } else {
      statusTitle = 'Bereits eingecheckt'
    }
    canUndo = true
  }

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow max-w-sm w-full text-center">
        <span className="text-6xl block mb-4">{statusIcon}</span>
        <h1 className={`text-2xl font-bold ${statusColor}`}>{statusTitle}</h1>
        <p className="text-xl font-medium text-gray-900 dark:text-gray-100 mt-3">{rsvp.participant.name}</p>
        {/* Personen der Antwort (docs/KONZEPT-EINLADUNGEN.md): eingecheckt wird die Antwort als Ganzes */}
        {rsvp.persons.filter(p => p.isAttending).length > 1 && (
          <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-1" data-testid="checkin-persons">
            {rsvp.persons.filter(p => p.isAttending).length} Personen: {attendingNames(personsOf(rsvp, rsvp.participant))}
          </p>
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
            <button type="submit" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">
              Rückgängig machen
            </button>
          </form>
        )}

        <Link href="/admin" className="block mt-8 text-sm text-blue-600 hover:underline">
          Zum Dashboard
        </Link>
      </div>
    </main>
  )
}
