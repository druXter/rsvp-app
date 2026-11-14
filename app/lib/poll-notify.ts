// app/lib/poll-notify.ts
import { signRsvpWebhookPayload } from './poll-verification'
import { prisma } from './prisma'

/**
 * Die Adresse, für die rsvp-app gegenüber dem Abstimmungstool einstehen kann: die eines bestätigten Kontos, mit dem
 * der Participant verknüpft ist (mit ihr stimmt das Konto ab, siehe poll-link.ts), sonst die am Participant, wenn er
 * sie selbst bestätigt hat. Eine unbestätigte Adresse kann irgendwer eingetippt haben - das Abstimmungstool löscht auf
 * eine Absage hin die Stimmen dieser Adresse (docs/AUDIT-2026-11.md, R-02).
 */
export async function provenEmail(participant: { email: string | null; isVerified: boolean; guestUserId: string | null }): Promise<string | null> {
  if (participant.guestUserId) {
    const account = await prisma.guestUser.findUnique({ where: { id: participant.guestUserId }, select: { email: true, isVerified: true } })
    if (account?.isVerified) return account.email
  }
  return participant.isVerified ? participant.email : null
}

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
 * Aufruf in try/catch eingebettet ist). No-op ohne bewiesene Adresse (provenEmail - die
 * Kopplung ist ausschließlich E-Mail-basiert), ohne event.pollUrl oder ohne konfiguriertes
 * ABSTIMMUNGSTOOL_BASE_URL/POLL_VERIFICATION_SECRET.
 */
export async function notifyPollOfAttendanceChange(
  event: { pollUrl: string | null; id: string },
  participant: { email: string | null; isVerified: boolean; guestUserId: string | null },
  attending: boolean
): Promise<void> {
  if (!event.pollUrl) return

  const base = abstimmungstoolBaseUrl()
  if (!base) return

  const email = await provenEmail(participant)
  if (!email) return

  const signed = signRsvpWebhookPayload(email, event.pollUrl, event.id, attending)
  if (!signed) return

  try {
    await fetch(`${base}/api/rsvp-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: signed.body,
      redirect: 'error', signal: AbortSignal.timeout(5000)
    })
  } catch {
    // Best-effort - siehe Doku-Kommentar oben, ein Fehlschlag hier darf nirgendwo
    // sonst im Aufrufer sichtbar werden.
  }
}
