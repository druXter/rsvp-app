// app/api/suite/login/route.ts
import type { NextRequest } from 'next/server'
import { buildAuthorizeRequestUrl, fetchDiscovery, normalizeOrigin, randomState, sanitizeNextPath } from 'suite-kit'
import { getCurrentUser, sessionCookieOptions } from '../../../lib/auth'
import { getIdps, selfOrigin } from '../../../lib/suite'
import { redirectResponse, SUITE_STATE_COOKIE, SUITE_STATE_MAX_AGE_SECONDS, type SuiteFlow } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * EMPFÄNGER-Seite, Schritt 1: Startet die Anmeldung mit einem Konto aus einem anderen
 * Tool (`?idp=<Origin>`). Erzeugt den einmaligen `state`, legt ihn in ein Cookie DIESES
 * Browsers und schickt den Browser zum Anbieter. Der Anbieter muss in SUITE_IDPS stehen -
 * die Adresse kommt nie ungeprüft aus der Anfrage.
 *
 * `mode=link` verknüpft stattdessen ein Konto mit dem bereits eingeloggten lokalen Konto
 * (Button unter /admin/account), statt ein neues Login zu erzeugen.
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const params = request.nextUrl.searchParams
  const mode: SuiteFlow['mode'] = params.get('mode') === 'link' ? 'link' : 'login'
  const next = sanitizeNextPath(params.get('next'), mode === 'link' ? '/admin/account' : '/admin')

  const issuer = normalizeOrigin(params.get('idp') ?? '')
  const idp = getIdps().find(i => i.issuer === issuer)
  if (!origin || !idp) return redirectResponse('/admin/login?error=sso', request.nextUrl.origin)

  if (mode === 'link' && !(await getCurrentUser())) {
    return redirectResponse(`/admin/login?next=${encodeURIComponent('/admin/account')}`, origin)
  }

  const discovery = await fetchDiscovery(idp.issuer)
  if (!discovery) return redirectResponse('/admin/login?error=idp-unreachable', origin)

  const state = randomState()
  const response = redirectResponse(buildAuthorizeRequestUrl(discovery.authorizeUrl, { app: origin, state }), origin)
  const flow: SuiteFlow = { state, issuer: idp.issuer, next, mode }
  response.cookies.set(SUITE_STATE_COOKIE, JSON.stringify(flow), sessionCookieOptions(SUITE_STATE_MAX_AGE_SECONDS))
  return response
}
