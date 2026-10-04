// app/api/suite/authorize/route.ts
import type { NextRequest } from 'next/server'
import { buildAuthorizeResponseUrl, issueLoginAssertion, issueParticipantAssertion, parseAuthorizeRequest, type AuthorizeRequest, type Signer } from 'suite-kit'
import { getCurrentUser } from '../../../lib/auth'
import { getCurrentGuestUser } from '../../../lib/guest-auth'
import { prisma } from '../../../lib/prisma'
import { getParticipantApps, getSigners, getTrustedApps, selfOrigin } from '../../../lib/suite'
import { redirectResponse } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * ANBIETER-Seite: Ein anderes Tool schickt den Browser hierher, um sich bestätigen zu
 * lassen, wer hier eingeloggt ist (Ablauf siehe suite-kit/README).
 *
 * - Nur Tools aus SUITE_TRUSTED_APPS erhalten je eine Bestätigung. Eine unbekannte `app`
 *   bekommt NIE eine Weiterleitung (sonst wäre das ein offener Redirect, der Bestätigungen
 *   an Fremde schickt), sondern landet auf einer Fehlermeldung in diesem Tool.
 * - Nicht eingeloggt: normaler Login, danach geht es genau hier weiter.
 * - Ohne `kind`: nur Verwaltungskonten (User) MIT lokalem Passwort werden bestätigt, nie rein
 *   föderierte: Sonst könnten Vertrauensketten entstehen (A vertraut B, B vertraut C, ...) und ein
 *   Tool würde Identitäten weiterreichen, für die es selbst nicht zuständig ist.
 * - `kind=participant`: Teilnehmendenkonten (GuestUser), siehe participant() unten.
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const signer = getSigners()[0]
  if (!origin || !signer) return new Response('Not found', { status: 404 })

  const parsed = parseAuthorizeRequest(request.nextUrl, getTrustedApps(), getParticipantApps())
  if (!parsed.ok) return redirectResponse(request.nextUrl.searchParams.get('kind') === 'participant' ? '/mein-konto/freigabe?error=app' : '/admin/login?error=app', origin)
  if (parsed.request.kind === 'participant') return participant(request, parsed.request, signer, origin)

  const user = await getCurrentUser()
  if (!user) {
    const here = request.nextUrl.pathname + request.nextUrl.search
    return redirectResponse(`/admin/login?next=${encodeURIComponent(here)}`, origin)
  }
  if (!user.passwordHash) return redirectResponse('/admin/account?error=nochain', origin)

  const assertion = issueLoginAssertion(signer, {
    issuer: origin,
    audience: parsed.request.app,
    subject: user.id,
    email: user.email,
    role: user.role,
    nonce: parsed.request.state
  })

  return redirectResponse(buildAuthorizeResponseUrl(parsed.request, assertion), origin)
}

/**
 * Teilnehmendenkonto (GuestUser) für ein Tool aus SUITE_PARTICIPANT_APPS bestätigen
 * (suite-kit: Teilnehmenden-Bestätigung). Nie für Verwaltungskonten - die Gast-Sitzung ist ein
 * eigenes Cookie. Ablauf: nicht angemeldet -> Gast-Login, danach hierher zurück; nur bestätigte
 * Konten; beim ersten Mal (oder nach Entzug) die Zustimmungsseite /mein-konto/freigabe. Übertragen
 * werden nur die paarweise Kennung aus GuestToolConsent und der Name - keine E-Mail.
 */
async function participant(request: NextRequest, req: AuthorizeRequest, signer: Signer, origin: string) {
  const here = request.nextUrl.pathname + request.nextUrl.search
  const guest = await getCurrentGuestUser()
  if (!guest) return redirectResponse(`/mein-konto/login?next=${encodeURIComponent(here)}`, origin)
  if (!guest.isVerified) return redirectResponse('/mein-konto/freigabe?error=unverified', origin)

  const consent = await prisma.guestToolConsent.findUnique({ where: { guestUserId_app: { guestUserId: guest.id, app: req.app } } })
  if (!consent || consent.revokedAt) {
    const params = new URLSearchParams({ app: req.app, state: req.state })
    return redirectResponse(`/mein-konto/freigabe?${params}`, origin)
  }

  await prisma.guestToolConsent.update({ where: { id: consent.id }, data: { lastUsedAt: new Date() } })
  const assertion = issueParticipantAssertion(signer, {
    issuer: origin,
    audience: req.app,
    subject: consent.subject,
    name: guest.name,
    nonce: req.state
  })
  return redirectResponse(buildAuthorizeResponseUrl(req, assertion), origin)
}
