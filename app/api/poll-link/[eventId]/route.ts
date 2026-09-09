// app/api/poll-link/[eventId]/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentGuestUser } from '../../../lib/guest-auth'
import { signPollVerificationToken } from '../../../lib/poll-verification'

const prisma = new PrismaClient()

/**
 * Leitet zur externen Abstimmung eines Termins weiter (Event.pollUrl, siehe
 * schema.prisma). Ist der aktuelle Besucher als GuestUser eingeloggt UND bereits
 * verifiziert, wird ein kurzlebiger, signierter Token angehängt (?verify=...) -
 * bei jedem Aufruf frisch erzeugt, damit er nicht durch langes Offenlassen der
 * Event-Seite schon abläuft, bevor überhaupt geklickt wird. Ohne aktive/verifizierte
 * Guest-Session (oder ohne konfiguriertes POLL_VERIFICATION_SECRET) führt derselbe
 * Link einfach ohne Token weiter - das Abstimmungstool entscheidet selbst, ob das
 * für die jeweilige Abstimmung ausreicht.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  const event = await prisma.event.findUnique({ where: { id: eventId } })

  if (!event || !event.pollUrl) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const guestUser = await getCurrentGuestUser()
  if (guestUser?.isVerified) {
    const token = signPollVerificationToken(guestUser.email, event.pollUrl)
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
