// app/lib/wichteln.ts
import {
  configuredTool, createSignedMessage, isConfirmedRsvp, resolveToolOrigin, toolDefinition, toolLinkOf, verifyEnvelope,
  type ConfiguredTool, type StoredToolLink, type ToolLink
} from './linked-tools'

/**
 * Vertrag mit Wichteln (eigenes Repo, dort app/lib/rsvp/token.ts und docs/KONZEPT.md Abschnitt 8). Format wie bei allen
 * verknüpften Tools (app/lib/linked-tools.ts), mit EIGENEM Secret WICHTELN_SECRET (dort RSVP_WICHTELN_SECRET):
 *
 * - wichtel-guests-request { typ, aud, wichtelnEventId, rsvpEventId, iat, exp } - Wichteln -> rsvp-app an
 *   /api/wichteln/guests. Antwort wichtel-guests { typ, aud, wichtelnEventId, rsvpEventId, guests: [{ rsvpId, name,
 *   email }], iat, exp }: alle Zusagen, die bei verknüpften Tools zählen (isConfirmedRsvp), mit E-Mail - Wichteln lädt
 *   sie zum Wichteln ein. Keine Begleitungen, keine weiteren Angaben.
 * - rsvp-change { typ, aud, wichtelnEventId, rsvpEventId, iat, exp } - rsvp-app -> Wichteln an /api/rsvp-webhook nach
 *   jeder Änderung einer Zusage. Nur ein Anstoß ohne Inhalt; Wichteln holt daraufhin die Gästeliste.
 *
 * Datei ohne Datenbankzugriffe (Unit-Tests); Datenbankseite: app/lib/wichteln-store.ts.
 */

const WICHTELN = toolDefinition('wichteln')
export const MAX_GUESTS = 5000

export function allowedWichtelnOrigin(): string | null {
  return resolveToolOrigin(WICHTELN)
}

export function wichtelnTool(): ConfiguredTool | null {
  return configuredTool('wichteln')
}

export function wichtelnLinkOf(event: { id: string; toolLinks: StoredToolLink[] }): ToolLink | null {
  return toolLinkOf(event, 'wichteln')
}

export type WichtelnRequest = { wichtelnEventId: string; rsvpEventId: string }

/** Prüft eine Anfrage wichtel-guests-request - oder null. */
export function verifyGuestsRequest(token: unknown, options: { secret: string; audience: string; now?: Date }): WichtelnRequest | null {
  const verified = verifyEnvelope(token, 'wichtel-guests-request', { ...options, remoteIdField: WICHTELN.remoteIdField })
  return verified ? { wichtelnEventId: verified.envelope.remoteEventId, rsvpEventId: verified.envelope.rsvpEventId } : null
}

export type WichtelnGuest = { rsvpId: string; name: string; email: string }

/** Eine Zusage für Wichteln: zählt sie (zugesagt, nicht Warteliste, ggf. verifiziert) und hat sie eine Adresse? */
export function wichtelnGuestOf(
  rsvp: { id: string; isAttending: boolean; isOnWaitlist: boolean },
  participant: { name: string; email: string | null; isVerified: boolean },
  requireVerification: boolean
): WichtelnGuest | null {
  if (!isConfirmedRsvp(rsvp, participant, requireVerification)) return null
  const email = participant.email?.trim().toLowerCase()
  const name = participant.name.trim().slice(0, 200)
  if (!email || !name) return null
  return { rsvpId: rsvp.id, name, email }
}

/** Antwort wichtel-guests (5 Minuten gültig). */
export function createGuestsReply(
  input: { aud: string; wichtelnEventId: string; rsvpEventId: string; guests: WichtelnGuest[] }, secret: string, now?: Date
): string {
  return createSignedMessage('wichtel-guests', input, secret, { now, ttlSeconds: 300 })
}

/** Anstoß rsvp-change für den Webhook (app/lib/linked-tools-notify.ts). */
export function wichtelnRsvpChange(input: { link: ToolLink; secret: string; rsvpEventId: string; now?: Date }): string {
  return createSignedMessage('rsvp-change', { aud: input.link.origin, wichtelnEventId: input.link.remoteEventId, rsvpEventId: input.rsvpEventId }, input.secret, { now: input.now })
}
