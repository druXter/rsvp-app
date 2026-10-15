// app/api/assembly-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { resolveVisitorRsvp } from '../../../lib/linked-tools-access'
import { isConfirmedRsvp } from '../../../lib/linked-tools'
import { assemblyOf, signAssemblyAccess } from '../../../lib/assembly'

export const dynamic = 'force-dynamic'

/** Nie cachen und die URL mit editToken bzw. Nachweis nicht per Referer weitergeben (wie beim Feedback-Link). */
function redirectTo(target: URL) {
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/**
 * "Zur Sitzung" (Idee L7, app/lib/assembly.ts): leitet eine Zusage, die zählt, mit einem frisch signierten Nachweis
 * (`?verify=`, 15 Minuten) zum Beitritt der Sitzung im Abstimmungstool weiter. Ob jemand abstimmen darf (anwesend),
 * fragt das Abstimmungstool bei jeder Stimme selbst ab - hier geht es nur um die Mitgliedschaft. Wer, prüft
 * resolveVisitorRsvp wie bei den verknüpften Tools (editToken oder verifizierte Gast-Session, PIN); alles andere landet
 * wieder auf der Event-Seite.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const token = new URL(request.url).searchParams.get('token') || null
  // BASE_URL statt request.url: Hinter einem Reverse Proxy zeigt request.url auf die interne Adresse des Containers.
  const base = process.env.BASE_URL || request.url

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })
  const assembly = event ? assemblyOf(event) : null
  if (!event || !assembly) return redirectTo(new URL('/', base))

  const visitor = await resolveVisitorRsvp(event, token)
  const { participant, rsvp } = visitor
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  if (!visitor.pinOk || !participant || !rsvp || !isConfirmedRsvp(rsvp, participant, requireVerification)) return redirectTo(visitor.back(base))

  const proof = signAssemblyAccess(assembly.assemblyId, event.id, rsvp.id, participant.name)
  if (!proof) return redirectTo(visitor.back(base))
  const target = new URL(`/sitzung/${assembly.assemblyId}/beitreten`, assembly.origin)
  target.searchParams.set('verify', proof)
  return redirectTo(target)
}
