// app/api/timeline-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { resolveToolLinkAccess } from '../../../lib/linked-tools-access'
import { createTimelineLink, isTimelineConfirmed } from '../../../lib/timeline'

export const dynamic = 'force-dynamic'

/** 303 wie im Vertrag mit Zeitplan: nie cachen und die URL mit dem editToken nicht per Referer weitergeben. */
function redirectTo(target: URL) {
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/**
 * "Zeitplan": leitet eine gültige Zusage mit einem kurz gültigen, signierten Link (typ
 * "timeline-link", siehe app/lib/timeline.ts) zum Zeitplan-Tool weiter -
 * `<Zeitplan-Link>?t=<Nachricht>`. Der Link wird bei JEDEM Klick neu ausgestellt; Seite und Mails
 * verlinken nur hierher (normales <a>, kein <Link> - ein Client-Router-Übergang in einen Route
 * Handler, der auf eine fremde Domain weiterleitet, hängt).
 *
 * Wer weitergeleitet wird (editToken genau dieses Termins oder verifizierte Gast-Session, PIN,
 * Zusage zählt), prüft resolveToolLinkAccess (app/lib/linked-tools-access.ts) wie bei "Sitzplatz
 * wählen" - alles andere landet wieder auf der Event-Seite, nie beim Zeitplan.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const access = await resolveToolLinkAccess(request, eventId, 'timeline', isTimelineConfirmed)
  if (!access.ok) return redirectTo(access.redirect)

  const { event, tool, link, rsvp } = access
  const target = new URL(link.url)
  target.searchParams.set('t', createTimelineLink({ link, rsvpEventId: event.id, rsvpId: rsvp.id }, tool.secret))
  return redirectTo(target)
}
