// app/admin/checkin/[rsvpId]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { toggleAttendance } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'

const prisma = new PrismaClient()

/**
 * Gesicherte Route, die beim Scannen des Einlass-QR-Codes geöffnet wird.
 * Schlanke, große Ansicht fürs schnelle Scannen am Handy - markiert den Gast
 * direkt beim Aufrufen der Seite als anwesend (kein zusätzlicher Klick nötig).
 */
export default async function CheckinPage({ params }: { params: Promise<{ rsvpId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { rsvpId } = await params
  const rsvp = await prisma.rsvp.findUnique({
    where: { id: rsvpId },
    include: { participant: true, event: true }
  })

  if (!rsvp) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-sm w-full text-center">
          <span className="text-5xl block mb-4">❓</span>
          <h1 className="text-xl font-bold text-red-600">Unbekannter QR-Code</h1>
          <p className="text-gray-500 mt-2">Diese Antwort existiert nicht (mehr).</p>
        </div>
      </main>
    )
  }

  if (!(await hasEventModeratorOrAbove(user, rsvp.event))) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow max-w-sm w-full text-center">
          <span className="text-5xl block mb-4">🔒</span>
          <h1 className="text-xl font-bold text-red-600">Nicht dein Event</h1>
          <p className="text-gray-500 mt-2">Dieser QR-Code gehört zu einem Event eines anderen Kontos.</p>
        </div>
      </main>
    )
  }

  let statusIcon = '✅'
  let statusTitle = 'Eingecheckt!'
  let statusColor = 'text-green-600'
  let canUndo = false

  if (!rsvp.event.enableCheckin) {
    statusIcon = '🚫'
    statusTitle = 'Check-in deaktiviert'
    statusColor = 'text-gray-500'
  } else if (!rsvp.isAttending) {
    statusIcon = '⚠️'
    statusTitle = 'Hat abgesagt'
    statusColor = 'text-red-600'
  } else if (rsvp.isOnWaitlist) {
    statusIcon = '⏳'
    statusTitle = 'Steht auf der Warteliste'
    statusColor = 'text-orange-600'
  } else {
    if (!rsvp.hasAttended) {
      await prisma.rsvp.update({ where: { id: rsvp.id }, data: { hasAttended: true, checkedInAt: new Date() } })
    } else {
      statusTitle = 'Bereits eingecheckt'
    }
    canUndo = true
  }

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-sm w-full text-center">
        <span className="text-6xl block mb-4">{statusIcon}</span>
        <h1 className={`text-2xl font-bold ${statusColor}`}>{statusTitle}</h1>
        <p className="text-xl font-medium text-gray-900 mt-3">{rsvp.participant.name}</p>
        <p className="text-gray-500">{rsvp.event.title}</p>

        {canUndo && (
          <form action={toggleAttendance} className="mt-6">
            <input type="hidden" name="rsvpId" value={rsvp.id} />
            <button type="submit" className="text-sm text-gray-500 hover:text-gray-700 underline">
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
