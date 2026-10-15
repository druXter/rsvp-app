// app/api/feedback-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { resolveVisitorRsvp } from '../../../lib/linked-tools-access'
import { feedbackEligible, feedbackOpen, feedbackSurveyOf, signFeedbackToken } from '../../../lib/feedback-link'

export const dynamic = 'force-dynamic'

/** Nie cachen und die URL mit editToken bzw. Nachweis nicht per Referer weitergeben (wie beim Zeitplan-Link). */
function redirectTo(target: URL) {
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/**
 * "Feedback geben" (Idee L8 Teil 2, app/lib/feedback-link.ts): leitet eine Zusage, die Feedback geben darf, mit
 * einem frisch signierten Nachweis (`?verify=`, 12 h gültig) zum Fragebogen im Abstimmungstool weiter. Seite, Mail
 * und Push verlinken nur hierher. Ändert nichts (Mail-Scanner dürfen den Link aufrufen); die Antwort entsteht erst
 * beim Absenden im Abstimmungstool.
 *
 * Wer weitergeleitet wird, prüft resolveVisitorRsvp wie bei den verknüpften Tools (editToken dieses Termins oder
 * verifizierte Gast-Session, PIN), dazu: Termin vorbei und die Zusage zählt (mit QR-Einlass: eingecheckt). Alles
 * andere landet wieder auf der Event-Seite, nie beim Fragebogen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const token = new URL(request.url).searchParams.get('token') || null
  // BASE_URL statt request.url: Hinter einem Reverse Proxy zeigt request.url auf die interne Adresse des Containers.
  const base = process.env.BASE_URL || request.url

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })
  const survey = event ? feedbackSurveyOf(event) : null
  if (!event || !survey) return redirectTo(new URL('/', base))

  const visitor = await resolveVisitorRsvp(event, token)
  const { participant, rsvp } = visitor
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  if (!visitor.pinOk || !participant || !rsvp || !feedbackOpen(event) || !feedbackEligible(event, rsvp, participant, requireVerification)) {
    return redirectTo(visitor.back(base))
  }

  const proof = signFeedbackToken(survey.surveyId, rsvp.id)
  if (!proof) return redirectTo(visitor.back(base))
  const target = new URL(survey.url)
  target.searchParams.set('verify', proof)
  return redirectTo(target)
}
