// app/lib/poll-notify.ts
import { signRsvpWebhookPayload } from './poll-verification'

function abstimmungstoolBaseUrl(): string | null {
  const url = process.env.ABSTIMMUNGSTOOL_BASE_URL
  return url ? url.replace(/\/+$/, '') : null
}

/**
 * Meldet aktiv eine Zu-/Absage-Änderung an abstimmungstool, damit eine bereits
 * abgegebene Stimme sofort entfernt wird, wenn die Person danach absagt - der
 * Klick-Token in poll-link/[eventId]/route.ts allein deckt das nicht ab, da er nur
 * beim nächsten Linkaufruf neu ausgestellt wird und die Person die Abstimmung nach
 * dem Abstimmen ja gerade nicht mehr zwingend erneut aufruft.
 *
 * Bewusst best-effort mit kurzem Timeout: ein nicht erreichbares/falsch
 * konfiguriertes abstimmungstool darf niemals die eigentliche RSVP-Abgabe
 * verzögern oder zum Scheitern bringen (siehe performRsvpSubmission, wo dieser
 * Aufruf in try/catch eingebettet ist). No-op ohne participant.email (die Kopplung
 * ist ausschließlich E-Mail-basiert), ohne event.pollUrl oder ohne konfiguriertes
 * ABSTIMMUNGSTOOL_BASE_URL/POLL_VERIFICATION_SECRET.
 */
export async function notifyPollOfAttendanceChange(
  event: { pollUrl: string | null; id: string },
  email: string | null,
  attending: boolean
): Promise<void> {
  if (!event.pollUrl || !email) return

  const base = abstimmungstoolBaseUrl()
  if (!base) return

  const signed = signRsvpWebhookPayload(email, event.pollUrl, event.id, attending)
  if (!signed) return

  try {
    await fetch(`${base}/api/rsvp-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: signed.body,
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    // Best-effort - siehe Doku-Kommentar oben, ein Fehlschlag hier darf nirgendwo
    // sonst im Aufrufer sichtbar werden.
  }
}
