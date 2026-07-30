// app/admin/page.tsx
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { logoutAdmin} from './actions'
import { redirect } from 'next/navigation'
import DeleteButton from './delete-button'
import DeleteRsvpButton from './delete-rsvp-button'

const prisma = new PrismaClient()

/**
 * Hilfsfunktion zum Abrufen aller Events aus der Datenbank.
 * Lädt die zugehörigen Gästelisten (RSVPs) direkt mit und sortiert diese nach Erstellungsdatum (neueste zuerst).
 */
const getEvents = () => {
  return prisma.event.findMany({
    include: {
      rsvps: {
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { date: 'asc' } // Events werden chronologisch nach Event-Datum sortiert
  })
}

// Typ-Ableitungen für eine sichere Verwendung der Daten in TypeScript
type EventWithRsvps = Awaited<ReturnType<typeof getEvents>>[number]
type RsvpType = EventWithRsvps['rsvps'][number]

/**
 * Das Haupt-Dashboard für den Administrationsbereich.
 * Zeigt alle Events, Statistiken und die kompletten Gästelisten an.
 */
export default async function AdminDashboard() {
  // Sicherheits-Check: Zugriff nur mit gültigem Admin-Cookie erlauben
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')

  if (!session || session.value !== 'true') {
    redirect('/admin/login')
  }

  const events = await getEvents()

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Globale Kopfzeile des Dashboards */}
        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow">
          <h1 className="text-2xl font-bold text-gray-900">RSVP Admin-Dashboard</h1>
          <div className="flex gap-4">
            <Link href="/admin/create" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium flex items-center">
              + Neues Event
            </Link>
            <form action={logoutAdmin}>
              <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition text-sm font-medium">
                Abmelden
              </button>
            </form>
          </div>
        </div>

        {/* Schleife durch alle existierenden Events */}
        {events.map((event: EventWithRsvps) => {
          // Basis-Statistiken für die Übersicht berechnen
          const attendingCount = event.rsvps.filter((r: RsvpType) => r.isAttending).length
          const decliningCount = event.rsvps.filter((r: RsvpType) => !r.isAttending).length

          return (
            <div key={event.id} className="bg-white p-6 rounded-lg shadow mb-6">
            
            {/* Kopfbereich eines einzelnen Events (Metadaten & Aktionen) */}
            <div className="border-b pb-4 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{event.title}</h2>
                <p className="text-sm text-gray-500">URL-Slug: <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">/{event.slug}</span></p>
                <div className="mt-2 flex gap-4 text-sm font-semibold">
                  <span className="text-green-600">✅ Zusagen: {attendingCount}</span>
                  <span className="text-red-600">❌ Absagen: {decliningCount}</span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Link href={`/admin/edit/${event.id}`} className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded hover:bg-blue-200 transition">
                  ✏️ Bearbeiten
                </Link>
                <DeleteButton eventId={event.id} />
              </div>
            </div>

              {/* Gästeliste & CSV-Export */}
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
                
                {/* Fallback, falls noch niemand geantwortet hat */}
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
                        <th className="p-2 text-right">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Einzelne Gäste-Antworten als Tabellenzeilen rendern */}
                      {event.rsvps.map(rsvp => (
                        <tr key={rsvp.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="p-2 font-medium text-gray-900">{rsvp.name}</td>
                          <td className="p-2">
                            {rsvp.isAttending 
                              ? <span className="text-green-600 font-semibold">Kommt</span>
                              : <span className="text-red-600 font-semibold">Abgesagt</span>}
                          </td>
                          
                          <td className="p-2 text-gray-600">{rsvp.email || '-'}</td>
                          <td className="p-2 text-gray-600">{rsvp.phone || '-'}</td>
                          
                          <td className="p-2 text-gray-600">
                            {rsvp.plusOne 
                              ? `Ja ${rsvp.plusOneName ? '(' + rsvp.plusOneName + ')' : ''}` 
                              : '-'}
                          </td>
                          
                          <td className="p-2 text-gray-600">{rsvp.dietaryOption || '-'}</td>
                          
                          <td className="p-2 text-gray-600">{rsvp.allergies || '-'}</td>
                          
                          <td className="p-2 text-gray-600">
                            {rsvp.drinksAlcohol === true ? 'Ja' : rsvp.drinksAlcohol === false ? 'Nein' : '-'}
                          </td>

                          <td className="p-2 text-gray-600">{rsvp.bringingItem || '-'}</td>

                          <td className="p-2 text-gray-500">
                            {rsvp.isAttending 
                              ? (rsvp.additionalInfo || '-') 
                              : (rsvp.declineReason || '-')}
                          </td>
                          
                          {/* Zeilenspezifische Aktionen (Bearbeiten/Löschen der Antwort) */}
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
        })}

      </div>
    </main>
  )
}