// app/lib/poll-verification.ts
import { createHmac, timingSafeEqual } from 'crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload))
  const signaturePart = base64url(createHmac('sha256', secret).update(payloadPart).digest())
  return `${payloadPart}.${signaturePart}`
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
 * Format (muss exakt zum Abstimmungstool passen):
 * `${base64url(JSON-Payload)}.${base64url(HMAC-SHA256(payloadPart, POLL_VERIFICATION_SECRET))}`
 * Payload: `{ email, pollId, attending, exp (Unix-Sekunden) }`.
 *
 * Gibt null zurück, wenn kein POLL_VERIFICATION_SECRET konfiguriert ist oder sich
 * keine Poll-ID aus der URL extrahieren lässt - der Aufrufer verlinkt dann einfach
 * ohne Token weiter (siehe app/api/poll-link/[eventId]/route.ts), das Feature bleibt
 * dadurch komplett optional.
 */
export function signPollVerificationToken(email: string, pollUrl: string, attending: boolean, ttlSeconds = 600): string | null {
  const secret = process.env.POLL_VERIFICATION_SECRET
  if (!secret) return null

  const pollId = extractPollId(pollUrl)
  if (!pollId) return null

  return sign({ email, pollId, attending, exp: Math.floor(Date.now() / 1000) + ttlSeconds }, secret)
}

/**
 * Signiert die Server-zu-Server-Meldung "diese verifizierte Person hat gerade ihre
 * Zu-/Absage für dieses Event geändert" an abstimmungstool (Gegenstück zu dessen
 * `verifyRsvpWebhookPayload`) - anders als der Klick-Token oben wird das aktiv aus
 * performRsvpSubmission heraus verschickt (siehe app/lib/rsvp-notify.ts), damit eine
 * bereits abgegebene Stimme auch dann entfernt wird, wenn die Person die Abstimmung
 * danach nie wieder aufruft. Selbes Format/Secret wie signPollVerificationToken, nur
 * mit `eventId` statt `attending` allein - abstimmungstool merkt sich daraus beiläufig,
 * welchem rsvp-app-Event diese Abstimmung zugeordnet ist (für die spätere
 * Ergebnis-Meldung beim Schließen, siehe dessen app/lib/rsvp-notify.ts).
 */
export function signRsvpWebhookPayload(email: string, pollUrl: string, eventId: string, attending: boolean): { pollId: string; body: string } | null {
  const secret = process.env.POLL_VERIFICATION_SECRET
  if (!secret) return null

  const pollId = extractPollId(pollUrl)
  if (!pollId) return null

  const token = sign({ email, pollId, eventId, attending, exp: Math.floor(Date.now() / 1000) + 600 }, secret)
  return { pollId, body: token }
}

/**
 * Prüft eine von abstimmungstool signierte Ergebnis-Meldung (Gegenstück zu dessen
 * `signResultWebhookPayload` in app/lib/rsvp-notify.ts dort) - dieselbe
 * base64url-Payload+HMAC-Machart wie oben, nur in die andere Richtung. Gibt bei
 * jedem Problem null zurück statt zu werfen, gleiche Begründung wie überall sonst
 * in dieser Kopplung: eine fehlgeschlagene Prüfung ist ein normaler, erwartbarer
 * Zustand (z.B. veraltetes/falsch konfiguriertes Secret), kein Serverfehler.
 */
export function verifyResultWebhookPayload(token: string | undefined | null): { eventId: string; pollId: string; pollTitle: string; winners: { label: string; votes: number }[]; closedAt: string } | null {
  const secret = process.env.POLL_VERIFICATION_SECRET
  if (!secret || !token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null

  const expectedSignature = base64url(createHmac('sha256', secret).update(payloadPart).digest())
  const expectedBuf = Buffer.from(expectedSignature)
  const actualBuf = Buffer.from(signaturePart)
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null

  let payload: {
    eventId?: unknown; pollId?: unknown; pollTitle?: unknown
    winners?: unknown; closedAt?: unknown; exp?: unknown
  }
  try {
    const padded = payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4)
    payload = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.eventId !== 'string' || !payload.eventId) return null
  if (typeof payload.pollId !== 'string' || !payload.pollId) return null
  if (typeof payload.pollTitle !== 'string') return null
  if (typeof payload.closedAt !== 'string') return null
  if (!Array.isArray(payload.winners)) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null

  return {
    eventId: payload.eventId,
    pollId: payload.pollId,
    pollTitle: payload.pollTitle,
    winners: payload.winners as { label: string; votes: number }[],
    closedAt: payload.closedAt
  }
}
