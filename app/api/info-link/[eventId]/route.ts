// app/api/info-link/[eventId]/route.ts
import { NextResponse } from 'next/server'
import { resolveToolLinkAccess } from '../../../lib/linked-tools-access'
import { createInfoPageLink, isInfoPageConfirmed } from '../../../lib/infopage'

export const dynamic = 'force-dynamic'

/** 303 wie beim Zeitplan: nie cachen und die URL mit dem editToken nicht per Referer weitergeben. */
function redirectTo(target: URL) {
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/**
 * „Infos für Gäste“ (Idee L38): leitet eine gültige Zusage mit einem kurz gültigen, signierten Link (typ
 * „info-page-link“, app/lib/infopage.ts) zur Seite mit Gäste-Bereich in der Startseite weiter -
 * `<Infoseite-Link>?t=<Nachricht>`, bei JEDEM Klick neu ausgestellt. Wer weitergeleitet wird (editToken genau dieses
 * Termins oder verifizierte Gast-Session, PIN, Zusage zählt), prüft resolveToolLinkAccess wie bei Zeitplan und
 * Seating - alles andere landet wieder auf der Event-Seite.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const access = await resolveToolLinkAccess(request, eventId, 'infopage', isInfoPageConfirmed)
  if (!access.ok) return redirectTo(access.redirect)

  const { event, tool, link, rsvp } = access
  const target = new URL(link.url)
  target.searchParams.set('t', createInfoPageLink({ link, rsvpEventId: event.id, rsvpId: rsvp.id }, tool.secret))
  return redirectTo(target)
}
