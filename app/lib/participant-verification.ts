// app/lib/participant-verification.ts
import { prisma } from './prisma'
import { sendWaitlistEmail, sendConfirmationEmail } from './mail'
import { notifyLinkedToolsOfRsvps } from './linked-tools-notify'

export type VerifiedRsvp = { title: string; slug: string; seriesSlug: string | null; isOnWaitlist: boolean }

/**
 * Double-Opt-In einer Zusage abschließen (Klick auf "Jetzt bestätigen" auf /verify, siehe
 * confirmParticipantVerification in app/actions.ts). Läuft bewusst NICHT schon beim Öffnen des
 * Mail-Links: Link-Scanner von Mail-Anbietern rufen Links automatisch ab und hätten die Adresse
 * sonst ohne die Person bestätigt.
 *
 * Die Verifizierung gilt für die Person (Participant), nicht für eine einzelne Antwort - sie
 * bestätigt daher alle ausstehenden Zusagen auf einmal (mehrere Termine einer Reihe). Der Token
 * wird atomar verbraucht (updateMany mit dem Token in der Bedingung), damit ein Doppelklick oder
 * zwei gleichzeitige Anfragen die Bestätigungs-Mails nicht doppelt auslösen. null = ungültig
 * oder schon verwendet.
 */
export async function verifyParticipantByToken(token: string): Promise<{ editToken: string; results: VerifiedRsvp[] } | null> {
  if (!token) return null
  const participant = await prisma.participant.findUnique({ where: { verifyToken: token } })
  if (!participant) return null

  const claimed = await prisma.participant.updateMany({
    where: { id: participant.id, verifyToken: token },
    data: { isVerified: true, verifiedAt: new Date(), verifyToken: null }
  })
  if (claimed.count !== 1) return null
  const verifiedParticipant = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })

  // Alle Zusagen dieser Person, die auf die Verifizierung gewartet haben
  const pendingRsvps = await prisma.rsvp.findMany({
    where: { participantId: participant.id, isAttending: true },
    include: { event: { include: { series: true } } }
  })

  // Nach der Verifizierung zählen diese Zusagen bei verknüpften Tools wie Seating (erst jetzt bestätigt)
  notifyLinkedToolsOfRsvps(pendingRsvps.map(r => r.id))

  const results: VerifiedRsvp[] = []
  for (const rsvp of pendingRsvps) {
    let finalIsOnWaitlist = rsvp.isOnWaitlist

    if (rsvp.isOnWaitlist && rsvp.event.maxCapacity !== null) {
      const currentAttendeesCount = await prisma.rsvp.count({
        where: { eventId: rsvp.eventId, isAttending: true, isOnWaitlist: false }
      })
      if (currentAttendeesCount < rsvp.event.maxCapacity) {
        finalIsOnWaitlist = false
      }
    }

    const updatedRsvp = await prisma.rsvp.update({
      where: { id: rsvp.id },
      data: { isOnWaitlist: finalIsOnWaitlist }
    })

    try {
      if (updatedRsvp.isOnWaitlist) {
        await sendWaitlistEmail(verifiedParticipant, updatedRsvp, rsvp.event)
      } else {
        await sendConfirmationEmail(verifiedParticipant, updatedRsvp, rsvp.event)
      }
    } catch (error) {
      console.error('Fehler beim Senden der Bestätigung nach Verifizierung:', error)
    }

    results.push({
      title: rsvp.event.title,
      slug: rsvp.event.slug,
      seriesSlug: rsvp.event.series?.slug ?? null,
      isOnWaitlist: updatedRsvp.isOnWaitlist
    })
  }

  return { editToken: verifiedParticipant.editToken, results }
}
