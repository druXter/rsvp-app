// app/api/poll-link/[eventId]/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentGuestUser } from '../../../lib/guest-auth'
import { signPollVerificationToken } from '../../../lib/poll-verification'
import { hasEventPinAccess } from '../../../lib/pin'

const prisma = new PrismaClient()

/**
 * Ermittelt, ob der eingeloggte Gast für GENAU DIESES Event aktuell zugesagt hat -
 * frisch bei jedem Linkklick nachgeschlagen (kein Zwischenspeichern), damit eine
 * nachträglich geänderte Antwort sich beim nächsten Klick sofort im Token
 * widerspiegelt (siehe signPollVerificationToken). guestUserId wird nur bei
 * Reihen-Participants gesetzt (siehe schema.prisma) - für ein Einzel-Event ohne
 * Reihe gibt es keine über ein Nutzer-Konto auflösbare Identität, daher dort immer
 * false (fail-closed, wie überall sonst in dieser Kopplung: nicht auflösbar heißt
 * nicht abstimmberechtigt, nicht automatisch erlaubt).
 */
async function resolveCurrentAttendance(event: { id: string; seriesId: string | null }, guestUserId: string): Promise<boolean> {
  if (!event.seriesId) return false

  const participant = await prisma.participant.findFirst({
    where: { guestUserId, seriesId: event.seriesId }
  })
  if (!participant) return false

  const rsvp = await prisma.rsvp.findUnique({
    where: { eventId_participantId: { eventId: event.id, participantId: participant.id } }
  })
  return rsvp?.isAttending ?? false
}

/**
 * Leitet zur externen Abstimmung eines Termins weiter (Event.pollUrl, siehe
 * schema.prisma). Ist der aktuelle Besucher als GuestUser eingeloggt UND bereits
 * verifiziert, wird ein kurzlebiger, signierter Token angehängt (?verify=...), der
 * zusätzlich zur E-Mail auch den aktuellen RSVP-Status für diesen Termin trägt
 * (siehe resolveCurrentAttendance) - bei jedem Aufruf frisch erzeugt, damit er nicht
 * durch langes Offenlassen der Event-Seite schon abläuft bzw. veraltet ist, bevor
 * überhaupt geklickt wird. Ohne aktive/verifizierte Guest-Session (oder ohne
 * konfiguriertes POLL_VERIFICATION_SECRET) führt derselbe Link einfach ohne Token
 * weiter - das Abstimmungstool entscheidet selbst, ob das für die jeweilige
 * Abstimmung ausreicht.
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

  const guestUser = await getCurrentGuestUser()
  if (guestUser?.isVerified) {
    const attending = await resolveCurrentAttendance(event, guestUser.id)
    const token = signPollVerificationToken(guestUser.email, event.pollUrl, attending)
    if (token) {
      try {
        const target = new URL(event.pollUrl)
        target.searchParams.set('verify', token)
        return NextResponse.redirect(target.toString())
      } catch {
        // Ungültige pollUrl - unten unverändert (ohne Token) weiterleiten.
      }
    }
  }

  return NextResponse.redirect(event.pollUrl)
}
