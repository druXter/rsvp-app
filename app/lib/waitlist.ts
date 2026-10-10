// app/lib/waitlist.ts
//
// Nachrücken von der Warteliste - EINE Regel für alle Wege, auf denen ein fester Platz frei wird (Absage
// über das Formular, Absage/Löschen/Stornieren in der Verwaltung, höhere Kapazität, geänderte Kontingente).
// Vorher lag die Logik doppelt in performRsvpSubmission und triggerWaitlistPromotion (app/admin/actions.ts).
// Platzregel und Reihenfolge: hasRoom/nextToPromote in app/lib/tickets.ts.
import type { Participant } from '@prisma/client'
import { prisma } from './prisma'
import { sendConfirmationEmail, sendWaitlistPromotedEmail } from './mail'
import { sendConfirmationPush } from './push'
import { notifyLinkedToolsOfRsvps } from './linked-tools-notify'
import { loadCapacity, nextToPromote } from './tickets'
import { syncPaymentDue } from './payment'

/**
 * Ob statt der Bestätigungs-Mail eine Push-Benachrichtigung (sendConfirmationPush) gehen soll - der Gast hat
 * das in seinem Nutzer-Konto so eingestellt (GuestUser.disableConfirmationEmails, siehe /mein-konto/account),
 * weil ihm die Info ohnehin per PWA-Push angezeigt wird. Betrifft nur die Bestätigungs-Mail; anonyme
 * editToken-Gäste ohne Konto (guestUserId null) bekommen sie unverändert immer.
 */
export async function shouldSuppressConfirmationEmail(participant: { guestUserId: string | null }) {
  if (!participant.guestUserId) return false
  const guestUser = await prisma.guestUser.findUnique({
    where: { id: participant.guestUserId },
    select: { disableConfirmationEmails: true }
  })
  return guestUser?.disableConfirmationEmails ?? false
}

/** Bestätigung an einen Nachrücker. Ein Versandfehler darf das Nachrücken (und die auslösende Aktion) nicht scheitern lassen. */
async function notifyPromoted(participant: Participant, rsvpId: string, eventId: string) {
  if (!participant.email) return
  try {
    const [rsvp, event] = await Promise.all([
      prisma.rsvp.findUniqueOrThrow({ where: { id: rsvpId } }),
      prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { series: true } })
    ])
    await sendWaitlistPromotedEmail(participant, rsvp, event)
    if (await shouldSuppressConfirmationEmail(participant)) {
      await sendConfirmationPush(event, participant)
    } else {
      await sendConfirmationEmail(participant, rsvp, event)
    }
  } catch (error) {
    console.error('Fehler beim Nachrücker-Mailversand:', error)
  }
}

/**
 * Lässt so viele Wartende nachrücken, wie gerade Platz ist - jeweils die am längsten wartende Zusage, für die
 * ihre Kategorie und der Termin insgesamt Platz haben (FIFO nach createdAt). Ist die effektive
 * requireVerification an, rücken nur verifizierte Personen nach. Ohne Kapazität und Kontingente ist für alle
 * Platz (etwa nachdem die Kapazität entfernt wurde). Benachrichtigt die Nachrücker per Mail/Push und verknüpfte Tools. Gibt die IDs der Nachrücker zurück.
 */
export async function fillFreeSeats(eventId: string): Promise<string[]> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })
  if (!event) return []
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

  const waiting = await prisma.rsvp.findMany({
    where: {
      eventId,
      isAttending: true,
      isOnWaitlist: true,
      ...(requireVerification ? { participant: { isVerified: true } } : {})
    },
    orderBy: { createdAt: 'asc' },
    include: { participant: true }
  })
  if (waiting.length === 0) return []

  const { limits, rsvps } = await loadCapacity(eventId)
  const tried = new Set<string>()
  const promoted: string[] = []
  for (;;) {
    const next = nextToPromote(limits, rsvps, waiting.filter(w => !tried.has(w.id)))
    if (!next) break
    tried.add(next.id)
    // Nur übernehmen, wenn die Zeile noch auf der Warteliste steht (gleichzeitige Absage oder "Zulassen")
    const updated = await prisma.rsvp.updateMany({ where: { id: next.id, isOnWaitlist: true, isAttending: true }, data: { isOnWaitlist: false } })
    if (updated.count !== 1) continue
    const seat = rsvps.find(r => r.id === next.id)
    if (seat) seat.isOnWaitlist = false
    promoted.push(next.id)
    // Zahlfrist ab jetzt, bevor die Bestätigung (mit Zahlungsdaten) rausgeht
    await syncPaymentDue({ rsvpIds: [next.id] })
    await notifyPromoted(next.participant, next.id, eventId)
  }

  if (promoted.length > 0) notifyLinkedToolsOfRsvps(promoted)
  return promoted
}
