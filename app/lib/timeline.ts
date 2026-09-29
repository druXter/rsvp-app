// app/lib/timeline.ts
import {
  configuredTool, createSignedMessage, isConfirmedRsvp, resolveToolOrigin, toolDefinition, toolLinkOf,
  type ConfiguredTool, type StoredToolLink, type ToolLink
} from './linked-tools'

/**
 * Vertrag mit dem Zeitplan-Tool (Ablauf großer Events, eigenes Repo und Deployment - dort
 * app/lib/rsvp/token.ts, docs/KONZEPT.md Abschnitt 8 und README "Anbindung an rsvp-app"). Format
 * und Prüfungen wie bei allen verknüpften Tools (app/lib/linked-tools.ts), mit EIGENEM Secret:
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, TIMELINE_SECRET))
 *
 * (dort RSVP_TIMELINE_SECRET). Beide Arten gehen nur rsvp-app -> Zeitplan:
 * - timeline-link: { typ, aud, timelineEventId, rsvpEventId, rsvpId, iat, exp } - über den Browser,
 *   bei jedem Klick auf "Zeitplan" frisch erzeugt (/api/timeline-link/[eventId]). Zeitplan legt
 *   damit eine Gast-Sitzung für diese Zusage an.
 * - rsvp-change:   { typ, aud, timelineEventId, rsvpEventId, rsvpId, attending, iat, exp } - Webhook
 *   an <Zeitplan>/api/rsvp-webhook; attending false beendet dort die Gast-Sitzungen der Zusage.
 *
 * Bewusst KEINE Namen, E-Mail-Adressen oder Begleitungen: Zeitplan braucht nur "diese Zusage
 * gilt". Datei ohne Datenbankzugriffe (Unit-Tests).
 */

const TIMELINE = toolDefinition('timeline')

/** Gültigkeit des Links in den Zeitplan - bei jedem Klick frisch ausgestellt (Zeitplan nimmt höchstens eine Stunde an). */
export const TIMELINE_LINK_TTL_SECONDS = 10 * 60

/** Der einzige Zeitplan-Origin, den ein Zeitplan-Link haben darf (TIMELINE_BASE_URL). */
export function allowedTimelineOrigin(): string | null {
  return resolveToolOrigin(TIMELINE)
}

export function timelineTool(): ConfiguredTool | null {
  return configuredTool('timeline')
}

/** Der Zeitplan-Link eines Termins, wenn die Anbindung eingerichtet ist und der Link gilt. */
export function timelineLinkOf(event: { id: string; toolLinks: StoredToolLink[] }): ToolLink | null {
  return toolLinkOf(event, 'timeline')
}

/** Zählt die Zusage beim Zeitplan? Dieselbe Regel wie bei Seating (isConfirmedRsvp). */
export const isTimelineConfirmed = isConfirmedRsvp

/** Der signierte Link für genau eine Zusage (typ timeline-link). */
export function createTimelineLink(
  input: { link: ToolLink; rsvpEventId: string; rsvpId: string },
  secret: string,
  options: { now?: Date; ttlSeconds?: number } = {}
): string {
  return createSignedMessage('timeline-link', {
    aud: input.link.origin,
    timelineEventId: input.link.remoteEventId,
    rsvpEventId: input.rsvpEventId,
    rsvpId: input.rsvpId
  }, secret, { ttlSeconds: TIMELINE_LINK_TTL_SECONDS, ...options })
}

/**
 * Inhalt des Webhooks "rsvp-change" an Zeitplan (verschickt von app/lib/linked-tools-notify.ts):
 * nur die Kennungen und ob die Zusage zählt - nach dem Löschen immer attending false.
 */
export function timelineRsvpChange(input: {
  link: ToolLink
  secret: string
  rsvpEventId: string
  rsvp: { id: string; isAttending: boolean; isOnWaitlist: boolean }
  participant: { isVerified: boolean }
  requireVerification: boolean
  deleted: boolean
}): string {
  const attending = !input.deleted && isTimelineConfirmed(input.rsvp, input.participant, input.requireVerification)
  return createSignedMessage('rsvp-change', {
    aud: input.link.origin,
    timelineEventId: input.link.remoteEventId,
    rsvpEventId: input.rsvpEventId,
    rsvpId: input.rsvp.id,
    attending
  }, input.secret)
}
