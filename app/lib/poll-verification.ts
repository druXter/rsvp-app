// app/lib/poll-verification.ts
import { createHmac } from 'crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Extrahiert die Poll-ID aus einer Abstimmungstool-URL (letztes Pfadsegment ohne
 * Query-String, z.B. "https://.../cmXYZ" -> "cmXYZ") - an dieses genaue URL-Schema
 * ist die Kopplung zwischen beiden Tools gebunden (siehe abstimmungstool README
 * "Token-Format"). Gibt null bei einer ungültigen/leeren URL zurück.
 */
function extractPollId(pollUrl: string): string | null {
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
 * "diese E-Mail gehört zu einem bei rsvp-app verifizierten Nutzer-Konto", ohne
 * Passwort oder Session zu teilen. An GENAU eine Abstimmung gebunden (pollId) und
 * kurz gültig (Standard 10 Minuten), damit ein weitergeleiteter Link nicht
 * dauerhaft nutzbar bleibt.
 *
 * Format (muss exakt zum Abstimmungstool passen):
 * `${base64url(JSON-Payload)}.${base64url(HMAC-SHA256(payloadPart, POLL_VERIFICATION_SECRET))}`
 * Payload: `{ email, pollId, exp (Unix-Sekunden) }`.
 *
 * Gibt null zurück, wenn kein POLL_VERIFICATION_SECRET konfiguriert ist oder sich
 * keine Poll-ID aus der URL extrahieren lässt - der Aufrufer verlinkt dann einfach
 * ohne Token weiter (siehe app/api/poll-link/[eventId]/route.ts), das Feature bleibt
 * dadurch komplett optional.
 */
export function signPollVerificationToken(email: string, pollUrl: string, ttlSeconds = 600): string | null {
  const secret = process.env.POLL_VERIFICATION_SECRET
  if (!secret) return null

  const pollId = extractPollId(pollUrl)
  if (!pollId) return null

  const payload = JSON.stringify({
    email,
    pollId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  })
  const payloadPart = base64url(payload)
  const signaturePart = base64url(createHmac('sha256', secret).update(payloadPart).digest())
  return `${payloadPart}.${signaturePart}`
}
