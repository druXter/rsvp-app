// app/lib/poll-verification.ts
//
// Kopplung mit dem Abstimmungstool: alle Nachrichten im gemeinsamen Format der Suite (suite-kit signLinkMessage,
// docs/KONVENTIONEN.md „Anbindungen“): `{ typ, aud, ...felder, iat, exp }`, HMAC mit POLL_VERIFICATION_SECRET (dort
// RSVP_VERIFICATION_SECRET). `typ` hält die Arten auseinander, `aud` ist der Origin des Empfängers. Gegenstück dort:
// app/lib/rsvp-verification.ts. Feste Prüfnachrichten auf beiden Seiten (tests/unit/poll-verification.test.ts).
import { signLinkMessage, verifyLinkMessage } from 'suite-kit'
import { ownOrigin } from './linked-tools'

/** Eingehende Nachrichten gelten höchstens so lange (das Abstimmungstool stellt sie für 5-10 Minuten aus). */
const INCOMING_MAX_TTL_SECONDS = 15 * 60

function pollSecret(): string | null {
  return process.env.POLL_VERIFICATION_SECRET || null
}

/** Origin des Abstimmungstools aus ABSTIMMUNGSTOOL_BASE_URL - Empfänger der Server-zu-Server-Meldungen. */
export function pollToolOrigin(): string | null {
  const url = process.env.ABSTIMMUNGSTOOL_BASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Signiert eine Nachricht ans Abstimmungstool. `audience` ist der Origin, an den sie geht (Standard: das eingerichtete
 * Abstimmungstool). null ohne Secret oder Empfänger - die Kopplung bleibt optional.
 */
export function signForPollTool(
  typ: string,
  fields: Record<string, unknown>,
  options: { audience?: string | null; ttlSeconds?: number; maxTtlSeconds?: number; now?: Date } = {}
): string | null {
  const secret = pollSecret()
  const audience = options.audience === undefined ? pollToolOrigin() : options.audience
  if (!secret || !audience) return null
  return signLinkMessage(typ, audience, fields, secret, { ttlSeconds: options.ttlSeconds, maxTtlSeconds: options.maxTtlSeconds, now: options.now })
}

/** Prüft eine Nachricht des Abstimmungstools: Signatur, Art, Empfänger (wir), Gültigkeit. Felder prüft der Aufrufer. */
export function verifyFromPollTool(token: unknown, typ: string, now?: Date): Record<string, unknown> | null {
  const secret = pollSecret()
  const audience = ownOrigin()
  if (!secret || !audience) return null
  return verifyLinkMessage(token, { typ, audience, secret, maxTtlSeconds: INCOMING_MAX_TTL_SECONDS, now })
}

/**
 * Extrahiert die Poll-ID aus einer Abstimmungstool-URL (letztes Pfadsegment ohne
 * Query-String, z.B. "https://.../cmXYZ" -> "cmXYZ") - an dieses genaue URL-Schema
 * ist die Kopplung zwischen beiden Tools gebunden (siehe abstimmungstool README
 * "Token-Format"). Gibt null bei einer ungültigen/leeren URL zurück.
 */
export function extractPollId(pollUrl: string): string | null {
  try {
    const url = new URL(pollUrl)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : null
  } catch {
    return null
  }
}

/**
 * Signiert einen kurzlebigen Verifizierungs-Token fürs abstimmungstool (Gegenstück
 * zu dessen `verifyRsvpToken` in app/lib/rsvp-verification.ts dort) - beweist
 * "diese E-Mail gehört zu einem bei rsvp-app verifizierten Nutzer-Konto UND deren
 * aktuellem RSVP-Status für den verlinkten Termin", ohne Passwort oder Session zu
 * teilen. An GENAU eine Abstimmung gebunden (pollId) und kurz gültig (Standard 10
 * Minuten), damit ein weitergeleiteter Link nicht dauerhaft nutzbar bleibt.
 *
 * `attending` wird bei JEDEM Klick frisch aus der aktuellen Rsvp abgeleitet (siehe
 * app/api/poll-link/[eventId]/route.ts) - dadurch schaltet eine nachträglich
 * geänderte Zusage sich beim nächsten Linkaufruf von selbst wieder frei, ganz ohne
 * zusätzliche Infrastruktur. Für eine bereits abgegebene Stimme, deren Zusage DANACH
 * zurückgezogen wird, sorgt stattdessen der separate rsvp-webhook (siehe
 * signRsvpWebhookPayload) für die aktive Entfernung.
 *
 * Nachricht `poll-access`: `{ email, pollId, attending }`, Empfänger ist der Origin der Abstimmung.
 *
 * Gibt null zurück, wenn kein POLL_VERIFICATION_SECRET konfiguriert ist oder sich
 * keine Poll-ID aus der URL extrahieren lässt - der Aufrufer verlinkt dann einfach
 * ohne Token weiter (siehe app/api/poll-link/[eventId]/route.ts), das Feature bleibt
 * dadurch komplett optional.
 */
export function signPollVerificationToken(email: string, pollUrl: string, attending: boolean, ttlSeconds = 600): string | null {
  const pollId = extractPollId(pollUrl)
  if (!pollId) return null
  // Empfänger ist, wohin der Link führt: Der Nachweis gilt nur dort.
  return signForPollTool('poll-access', { email, pollId, attending }, { audience: new URL(pollUrl).origin, ttlSeconds })
}

/**
 * Signiert die Server-zu-Server-Meldung "diese verifizierte Person hat gerade ihre
 * Zu-/Absage für dieses Event geändert" an abstimmungstool (Gegenstück zu dessen
 * `verifyRsvpWebhookPayload`) - anders als der Klick-Token oben wird das aktiv aus
 * performRsvpSubmission heraus verschickt (siehe app/lib/rsvp-notify.ts), damit eine
 * bereits abgegebene Stimme auch dann entfernt wird, wenn die Person die Abstimmung
 * danach nie wieder aufruft. Nachricht `poll-attendance` an ABSTIMMUNGSTOOL_BASE_URL,
 * zusätzlich mit `eventId` - abstimmungstool merkt sich daraus beiläufig,
 * welchem rsvp-app-Event diese Abstimmung zugeordnet ist (für die spätere
 * Ergebnis-Meldung beim Schließen, siehe dessen app/lib/rsvp-notify.ts).
 */
export function signRsvpWebhookPayload(email: string, pollUrl: string, eventId: string, attending: boolean): { pollId: string; body: string } | null {
  const pollId = extractPollId(pollUrl)
  if (!pollId) return null
  const body = signForPollTool('poll-attendance', { email, pollId, eventId, attending })
  return body ? { pollId, body } : null
}

export type PollResultUnit = 'votes' | 'points'

/**
 * Prüft die Ergebnis-Meldung des Abstimmungstools (`poll-result`, Gegenstück zu dessen
 * `signResultWebhookPayload`). null bei jedem Problem - eine fehlgeschlagene Prüfung ist erwartbar
 * (z.B. falsch konfiguriertes Secret), kein Serverfehler.
 *
 * `quorumMet` (false = Mindestbeteiligung verfehlt, "nicht beschlussfähig") und `unit` ("points" bei
 * Abstimmungsarten mit Wertung statt Stimmen) sind optional und fehlen in Meldungen älterer
 * abstimmungstool-Versionen - dann gelten true bzw. "votes".
 */
export function verifyResultWebhookPayload(token: string | undefined | null): { eventId: string; pollId: string; pollTitle: string; winners: { label: string; votes: number }[]; closedAt: string; quorumMet: boolean; unit: PollResultUnit } | null {
  const payload = verifyFromPollTool(token, 'poll-result')
  if (!payload) return null

  if (typeof payload.eventId !== 'string' || !payload.eventId) return null
  if (typeof payload.pollId !== 'string' || !payload.pollId) return null
  if (typeof payload.pollTitle !== 'string') return null
  if (typeof payload.closedAt !== 'string') return null
  if (!Array.isArray(payload.winners)) return null
  if (payload.quorumMet !== undefined && typeof payload.quorumMet !== 'boolean') return null
  if (payload.unit !== undefined && payload.unit !== 'votes' && payload.unit !== 'points') return null

  return {
    quorumMet: payload.quorumMet !== false,
    unit: payload.unit === 'points' ? 'points' : 'votes',
    eventId: payload.eventId,
    pollId: payload.pollId,
    pollTitle: payload.pollTitle,
    winners: payload.winners as { label: string; votes: number }[],
    closedAt: payload.closedAt
  }
}

/** Wem die Abstimmung gehört: Konto-ID im Abstimmungstool und - falls dort verknüpft - die rsvp-app-Konto-ID. */
export type PollDateOwner = { toolUserId: string; rsvpUserId: string | null }

export type PollDateMessage =
  | { typ: 'poll-date-status'; pollId: string; owner: PollDateOwner }
  | { typ: 'poll-date-set'; pollId: string; pollTitle: string; startsAt: Date; owner: PollDateOwner; create: boolean; skipEmailHashes: string[] }

function readOwner(value: unknown): PollDateOwner | null {
  if (!value || typeof value !== 'object') return null
  const { toolUserId, rsvpUserId } = value as Record<string, unknown>
  if (typeof toolUserId !== 'string' || !toolUserId || toolUserId.length > 100) return null
  if (rsvpUserId !== null && (typeof rsvpUserId !== 'string' || !rsvpUserId || rsvpUserId.length > 100)) return null
  return { toolUserId, rsvpUserId: rsvpUserId as string | null }
}

/**
 * Nachrichten der Terminabstimmung (Gegenstück zu app/lib/rsvp-date.ts im Abstimmungstool,
 * siehe app/lib/poll-date.ts hier): `poll-date-status` und `poll-date-set`.
 */
export function verifyPollDateMessage(token: string | undefined | null): PollDateMessage | null {
  const payload = verifyFromPollTool(token, 'poll-date-status') ?? verifyFromPollTool(token, 'poll-date-set')
  if (!payload) return null
  const pollId = payload.pollId
  const owner = readOwner(payload.owner)
  if (typeof pollId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(pollId) || !owner) return null

  if (payload.typ === 'poll-date-status') return { typ: 'poll-date-status', pollId, owner }

  if (payload.typ === 'poll-date-set') {
    const { pollTitle, startsAt, create, skipEmailHashes } = payload
    if (typeof pollTitle !== 'string' || !pollTitle.trim() || pollTitle.length > 200) return null
    if (typeof startsAt !== 'string') return null
    const date = new Date(startsAt)
    if (Number.isNaN(date.getTime())) return null
    if (typeof create !== 'boolean') return null
    if (!Array.isArray(skipEmailHashes) || skipEmailHashes.length > 10_000 || !skipEmailHashes.every(h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))) return null
    return { typ: 'poll-date-set', pollId, pollTitle: pollTitle.trim(), startsAt: date, owner, create, skipEmailHashes }
  }
  return null
}
