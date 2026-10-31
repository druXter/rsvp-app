// app/lib/infopage.ts
import {
  configuredTool, createSignedMessage, isConfirmedRsvp, resolveToolOrigin, toolDefinition, toolLinkOf,
  type ConfiguredTool, type StoredToolLink, type ToolLink
} from './linked-tools'

/**
 * Vertrag mit der Startseite (Idee L38 „Seiten nur für Gäste“, eigenes Repo und Deployment - dort
 * app/lib/rsvp/token.ts). Genau wie der Zeitplan (app/lib/timeline.ts), mit EIGENEM Secret:
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, STARTSEITE_SECRET))
 *
 * (dort RSVP_STARTSEITE_SECRET). Beide Arten gehen nur rsvp-app -> Startseite:
 * - info-page-link: { typ, aud, pageId, rsvpEventId, rsvpId, iat, exp } - über den Browser, bei jedem Klick auf
 *   „Infos für Gäste“ frisch erzeugt (/api/info-link/[eventId]). Die Startseite legt damit eine Gast-Sitzung an, die
 *   die Blöcke „nur für Gäste“ zeigt.
 * - rsvp-change:    { typ, aud, pageId, rsvpEventId, rsvpId, attending, iat, exp } - Webhook an
 *   <Startseite>/api/rsvp-webhook; attending false beendet dort die Gast-Sitzungen der Zusage.
 *
 * Bewusst KEINE Namen oder E-Mail-Adressen: Die Startseite braucht nur „diese Zusage gilt“. Datei ohne
 * Datenbankzugriffe (Unit-Tests, feste Prüfnachrichten in tests/unit/infopage.test.ts und bei der Startseite).
 */

const INFOPAGE = toolDefinition('infopage')

/** Gültigkeit des Links zur Infoseite - bei jedem Klick frisch ausgestellt. */
export const INFOPAGE_LINK_TTL_SECONDS = 10 * 60

/** Der einzige Origin, den ein Infoseite-Link haben darf (STARTSEITE_BASE_URL). */
export function allowedInfoPageOrigin(): string | null {
  return resolveToolOrigin(INFOPAGE)
}

export function infoPageTool(): ConfiguredTool | null {
  return configuredTool('infopage')
}

/** Der Infoseite-Link eines Termins, wenn die Anbindung eingerichtet ist und der Link gilt. */
export function infoPageLinkOf(event: { id: string; toolLinks: StoredToolLink[] }): ToolLink | null {
  return toolLinkOf(event, 'infopage')
}

/** Zählt die Zusage für den Gäste-Bereich? Dieselbe Regel wie bei Seating und Zeitplan (isConfirmedRsvp). */
export const isInfoPageConfirmed = isConfirmedRsvp

/** Der signierte Link für genau eine Zusage (typ info-page-link). */
export function createInfoPageLink(
  input: { link: ToolLink; rsvpEventId: string; rsvpId: string },
  secret: string,
  options: { now?: Date; ttlSeconds?: number } = {}
): string {
  return createSignedMessage('info-page-link', {
    aud: input.link.origin,
    pageId: input.link.remoteEventId,
    rsvpEventId: input.rsvpEventId,
    rsvpId: input.rsvpId
  }, secret, { ttlSeconds: INFOPAGE_LINK_TTL_SECONDS, ...options })
}

/** Inhalt des Webhooks „rsvp-change“ an die Startseite: nur Kennungen und ob die Zusage zählt. */
export function infoPageRsvpChange(input: {
  link: ToolLink
  secret: string
  rsvpEventId: string
  rsvp: { id: string; isAttending: boolean; isOnWaitlist: boolean }
  participant: { isVerified: boolean }
  requireVerification: boolean
  deleted: boolean
}, options: { now?: Date } = {}): string {
  const attending = !input.deleted && isInfoPageConfirmed(input.rsvp, input.participant, input.requireVerification)
  return createSignedMessage('rsvp-change', {
    aud: input.link.origin,
    pageId: input.link.remoteEventId,
    rsvpEventId: input.rsvpEventId,
    rsvpId: input.rsvp.id,
    attending
  }, input.secret, options)
}
