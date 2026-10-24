// app/api/poll-link/[eventId]/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentGuestUser } from '../../../lib/guest-auth'
import { personalPollLink } from '../../../lib/poll-link'
import { hasEventPinAccess } from '../../../lib/pin'

const prisma = new PrismaClient()

/**
 * Leitet zur externen Abstimmung eines Termins weiter (Event.pollUrl, siehe
 * schema.prisma). Ist der aktuelle Besucher als GuestUser eingeloggt UND bereits
 * verifiziert, wird ein kurzlebiger, signierter Token angehängt (?verify=...), der
 * zusätzlich zur E-Mail auch den aktuellen RSVP-Status für diesen Termin trägt
 * (siehe app/lib/poll-link.ts) - bei jedem Aufruf frisch erzeugt, damit er nicht
 * durch langes Offenlassen der Event-Seite schon abläuft bzw. veraltet ist, bevor
 * überhaupt geklickt wird. Ohne aktive/verifizierte Guest-Session (oder ohne
 * konfiguriertes POLL_VERIFICATION_SECRET) führt derselbe Link einfach ohne Token
 * weiter - das Abstimmungstool entscheidet selbst, ob das für die jeweilige
 * Abstimmung ausreicht. Gegenstück für Clients mit API-Token:
 * GET /api/v1/termine/[eventId]/abstimmung.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })

  // Die Abstimmungs-URL eines PIN-geschützten Events wird ohne PIN nicht herausgegeben.
  if (!event || !event.pollUrl || !(await hasEventPinAccess(event))) {
    // BASE_URL statt request.url: Hinter einem Reverse Proxy zeigt request.url auf die interne Adresse des Containers.
    return NextResponse.redirect(new URL('/', process.env.BASE_URL || request.url))
  }

  const { url } = await personalPollLink({ ...event, pollUrl: event.pollUrl }, await getCurrentGuestUser())
  return NextResponse.redirect(url)
}
