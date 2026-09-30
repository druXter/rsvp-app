// app/lib/event-change-notify.ts
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { sendEventUpdatedEmail } from './mail'
import { sendEventChangedPush } from './push'

/** SHA-256 einer normalisierten E-Mail-Adresse (hex) - Vergleichswert für skipEmailHashes. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Verschickt die Änderungs-Mail (siehe sendEventUpdatedEmail) an alle Gäste mit fester
 * Zusage oder Wartelisten-Platz zu genau diesem Termin - unabhängig von Reihen-
 * Zugehörigkeit gilt Kapazität/Teilnahme wie überall sonst pro Termin. Berücksichtigt bei
 * einer Reihe die reihenweite requireVerification (siehe CLAUDE.md "Effective settings").
 *
 * `skipEmailHashes` (nur Terminabstimmung, siehe app/lib/poll-date.ts): Adressen, die das
 * Abstimmungstool selbst schon über den festgelegten Termin informiert - diese Gäste bekommen
 * hier weder Mail noch Push, damit niemand dieselbe Nachricht doppelt erhält.
 */
export async function notifyAttendeesOfChange(
  eventId: string,
  changes: { label: string; detail: string }[],
  { skipEmailHashes = [] }: { skipEmailHashes?: string[] } = {}
) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rsvps: { where: { isAttending: true }, include: { participant: true } },
      series: true
    }
  })
  if (!event) return

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const skip = new Set(skipEmailHashes)
  const rsvps = event.rsvps.filter(rsvp => !(rsvp.participant.email && skip.has(emailHash(rsvp.participant.email))))

  const validRsvps = rsvps.filter(rsvp =>
    rsvp.participant.email && rsvp.participant.email.trim() !== '' &&
    (!requireVerification || rsvp.participant.isVerified)
  )

  const emailPromises = validRsvps.map(rsvp =>
    sendEventUpdatedEmail(rsvp.participant, rsvp, event, changes)
  )
  // Push ist an die Participant-Identität geknüpft, nicht an eine verifizierte E-Mail -
  // gilt daher für alle Teilnehmenden, die effektiv verifiziert sind (bzw. für die es gar
  // nicht nötig ist), unabhängig davon, ob überhaupt eine E-Mail hinterlegt wurde.
  const pushEligibleRsvps = rsvps.filter(rsvp => !requireVerification || rsvp.participant.isVerified)
  const pushPromises = pushEligibleRsvps.map(rsvp =>
    sendEventChangedPush(event, rsvp.participant, changes)
  )
  await Promise.allSettled([...emailPromises, ...pushPromises])
}
