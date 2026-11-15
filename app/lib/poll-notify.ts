// app/lib/poll-notify.ts
import { extractPollId, pollToolOrigin, signForPollTool, signRsvpWebhookPayload } from './poll-verification'
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

/**
 * Beim Speichern eines Abstimmungs-Links: meldet dem Abstimmungstool, dass dieser Termin auf die Abstimmung zeigt
 * (`poll-link`, POST /api/rsvp-poll-link dort). Eine Abstimmung "nur über rsvp-app" bindet sich dort nicht mehr an den
 * ersten Termin, der sich meldet: Die Besitzerin bestätigt den Termin auf ihrer Verwaltungsseite - dafür bekommt sie
 * hier Titel und Kennung (abstimmungstool docs/AUDIT-2026-11.md, V-01 b). Ohne Rückfrage bindet das Abstimmungstool
 * nur, wenn der Termin dem Konto gehört, das über den Suite-Verbund mit dem Konto der Besitzerin verknüpft ist: Dafür
 * gehen unsere Konto-ID des Event-Owners und - falls hier bekannt - seine Konto-ID im Abstimmungstool mit.
 *
 * Best-effort wie die Zu-/Absage-Meldung: Das Speichern hängt nie davon ab. Nur für Links auf das eingerichtete
 * Abstimmungstool; meldet sich niemand, meldet das Abstimmungstool den Termin beim ersten Klick als unbestätigt.
 */
export async function announcePollLink(pollUrl: string, event: { id: string; title: string; ownerId: string }): Promise<void> {
  const origin = pollToolOrigin()
  const pollId = extractPollId(pollUrl)
  let sameTool = false
  try { sameTool = !!origin && new URL(pollUrl).origin === origin } catch { /* kein Link aufs Abstimmungstool */ }
  if (!origin || !pollId || !sameTool) return

  const identity = await prisma.externalIdentity.findFirst({ where: { userId: event.ownerId, issuer: origin }, select: { subject: true } })
  const body = signForPollTool('poll-link', {
    pollId, eventId: event.id, eventTitle: event.title.slice(0, 200),
    owner: { rsvpUserId: event.ownerId, toolUserId: identity?.subject ?? null }
  }, { audience: origin, ttlSeconds: 5 * 60 })
  if (!body) return
  try {
    await fetch(`${origin}/api/rsvp-poll-link`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'error', signal: AbortSignal.timeout(5000)
    })
  } catch {
    // Best-effort, siehe oben.
  }
}
