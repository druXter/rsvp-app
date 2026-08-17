import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import RsvpForm from './rsvp-form'
import PinForm from './pin-form'

const prisma = new PrismaClient()

export default async function EventPage({ 
  params,
  searchParams 
}: { 
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // FIX: In Next.js 15+ müssen params und searchParams asynchron aufgelöst werden!
  const { slug } = await params;
  const currentSearchParams = await searchParams;

  const event = await prisma.event.findUnique({
    where: { slug: slug },
  })

  if (!event) notFound()

  // 1. Zugangsprüfung (Issue #9)
  let isAuthorized = true;
  if (event.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`event_pin_${event.id}`)
    
    if (pinCookie?.value !== event.eventPin) {
      isAuthorized = false;
    }
  }

  // Wenn nicht berechtigt, zeige nur das PIN-Formular
  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50">
        <PinForm eventId={event.id} slug={event.slug} title={event.title} />
      </main>
    )
  }

  // 2. Token aus der URL auslesen und bestehendes RSVP laden
  const token = typeof currentSearchParams?.token === 'string' ? currentSearchParams.token : undefined
  let existingRsvp = null
  
  if (token) {
    existingRsvp = await prisma.rsvp.findUnique({
      where: { editToken: token }
    })
  }

  // 3. Gästeliste laden (Issue #8) - EXTREM WICHTIG: Nur ungefährliche Felder abfragen!
  let publicRsvps: any[] = [];
  if (event.isGuestListVisible) {
    publicRsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        name: true,
        isAttending: true,
        isOnWaitlist: true,
        plusOne: true,
        plusOneName: true,
        bringingItem: true,
        declineReason: true,
        createdAt: true
        // E-MAIL, HANDYNUMMER, ALLERGIEN SIND HIER ABSICHTLICH NICHT DABEI!
      },
      orderBy: { createdAt: 'asc' }
    })
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-4">
        
        {/* Das eigentliche Formular */}
        <RsvpForm 
          eventId={event.id} 
          formConfig={event.formConfig} 
          existingRsvp={existingRsvp} 
        />

        {/* Die öffentliche Gästeliste */}
        {event.isGuestListVisible && (
          <div className="mt-12 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold mb-4 text-gray-800">Gästeliste</h3>
            
            {publicRsvps.length === 0 ? (
              <p className="text-gray-500 italic">Noch keine Rückmeldungen vorhanden.</p>
            ) : (
              <ul className="space-y-3">
                {publicRsvps.map((guest) => (
                  <li key={guest.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 rounded border border-gray-100">
                    <div>
                      <span className="font-bold text-gray-800">{guest.name}</span>
                      {guest.plusOne && guest.plusOneName && (
                        <span className="text-gray-500 text-sm ml-1">(+ {guest.plusOneName})</span>
                      )}
                      
                      {/* Mitbringsel anzeigen, falls Zusage */}
                      {guest.isAttending && guest.bringingItem && (
                        <div className="text-sm text-blue-600 mt-1">
                          🍕 Bringt mit: {guest.bringingItem}
                        </div>
                      )}
                      
                      {/* Absagegrund anzeigen, falls Absage */}
                      {!guest.isAttending && guest.declineReason && (
                        <div className="text-sm text-gray-500 mt-1 italic">
                          "{guest.declineReason}"
                        </div>
                      )}
                    </div>

                    <div className="mt-2 sm:mt-0">
                      {guest.isAttending ? (
                        guest.isOnWaitlist ? (
                          <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded-full font-bold">Warteliste</span>
                        ) : (
                          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-bold">Dabei</span>
                        )
                      ) : (
                        <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full font-bold">Abgesagt</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </main>
  )
}