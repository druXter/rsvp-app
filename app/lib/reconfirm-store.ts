// app/lib/reconfirm-store.ts
//
// Rückbestätigung vor dem Termin (Idee L30) - Datenbank und Versand: Nachfrage per Cron, Antwort des Gasts (Knöpfe auf
// der Gästeseite), automatische Absage an der Frist, Zurücksetzen nach einer Verschiebung. Die Regeln stehen in
// app/lib/reconfirm.ts.
import { prisma } from './prisma'
import { isConfirmedRsvp } from './linked-tools'
import { notifyLinkedToolsOfRsvps } from './linked-tools-notify'
import { notifyPollOfAttendanceChange } from './poll-notify'
import { fillFreeSeats } from './waitlist'
import { deadlinePassed } from './rsvp-deadline'
import { sendReconfirmLapsedEmail, sendReconfirmRequestEmail } from './mail'
import { canPushParticipant, sendReconfirmLapsedPush, sendReconfirmRequestPush } from './push'
import { autoDeclinable, formatReconfirmTime, reconfirmApplies, reconfirmRunning, reconfirmWindow } from './reconfirm'

const DAY = 24 * 60 * 60 * 1000

function logFailures(results: PromiseSettledResult<unknown>[], what: string) {
  for (const r of results) if (r.status === 'rejected') console.error(`Fehler bei ${what}:`, r.reason)
}

/** Termine mit Rückbestätigung, die noch nicht begonnen haben (ein Termin hat höchstens 30 Tage Vorlauf). */
async function runningEvents(now: Date, eventId?: string) {
  const events = await prisma.event.findMany({
    where: { reconfirmDays: { not: null }, datePending: false, date: { gt: now, lte: new Date(now.getTime() + 31 * DAY) }, ...(eventId ? { id: eventId } : {}) },
    include: { series: true }
  })
  return events.filter(e => reconfirmRunning(e, now))
}

const effectiveRequireVerification = (event: { requireVerification: boolean; series: { requireVerification: boolean } | null }) =>
  event.series ? event.series.requireVerification : event.requireVerification

/**
 * Cron: fragt jede feste Zusage, deren Termin im Zeitraum liegt, einmal „Kommst du noch?“ - per Mail (hinterlegte
 * Adresse) und Push. Als gefragt gilt nur, wen mindestens einer der beiden Wege erreicht; die Zeile wird VOR dem
 * Versand atomar beansprucht. Auch nach der Frist kommt die Frage noch (z. B. Nachrücker), abgesagt wird dann aber
 * nicht mehr automatisch (autoDeclinable). Gibt die Zahl der Nachfragen zurück.
 */
export async function sendDueReconfirmRequests(now: Date = new Date(), eventId?: string): Promise<number> {
  let sent = 0
  for (const event of await runningEvents(now, eventId)) {
    const window = reconfirmWindow(event)!
    const requireVerification = effectiveRequireVerification(event)
    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id, isAttending: true, isOnWaitlist: false, reconfirmAskedAt: null, reconfirmedAt: null, hasAttended: false, shiftHelperId: null },
      include: { participant: true }
    })
    for (const rsvp of rsvps) {
      if (!reconfirmApplies(rsvp, isConfirmedRsvp(rsvp, rsvp.participant, requireVerification))) continue
      const byMail = !!rsvp.participant.email
      const byPush = await canPushParticipant(rsvp.participantId)
      if (!byMail && !byPush) continue
      const claimed = await prisma.rsvp.updateMany({ where: { id: rsvp.id, reconfirmAskedAt: null, reconfirmedAt: null }, data: { reconfirmAskedAt: now } })
      if (claimed.count !== 1) continue
      logFailures(await Promise.allSettled([
        byMail ? sendReconfirmRequestEmail(rsvp.participant, event, window.deadline) : Promise.resolve(),
        byPush ? sendReconfirmRequestPush(event, rsvp.participant, formatReconfirmTime(window.deadline)) : Promise.resolve()
      ]), 'der Rückbestätigung')
      sent++
    }
  }
  return sent
}

/**
 * Gibt einen festen Platz frei (Absage per Knopf oder automatisch an der Frist): Antwort und Personen auf Absage,
 * Mitbringliste frei, verknüpfte Tools und Abstimmung informieren, Warteliste nachrücken lassen. Atomar über den
 * Zustand im where - eine gleichzeitige Bestätigung, ein Einlass oder eine Änderung gewinnt. `extra` grenzt weiter ein.
 */
async function releaseSeat(rsvpId: string, data: { reconfirmLapsedAt: Date | null }, extra: { reconfirmedAt?: null } = {}): Promise<boolean> {
  const released = await prisma.rsvp.updateMany({
    where: { id: rsvpId, isAttending: true, isOnWaitlist: false, hasAttended: false, shiftHelperId: null, ...extra },
    // Kein Absagegrund: der stünde bei sichtbarer Gästeliste öffentlich neben dem Namen
    data: { isAttending: false, declineReason: null, paymentDueAt: null, reconfirmedAt: null, ...data }
  })
  if (released.count !== 1) return false
  const rsvp = await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvpId }, include: { participant: true, event: true } })
  await prisma.rsvpPerson.updateMany({ where: { rsvpId }, data: { isAttending: false, checkedInAt: null, leftAt: null } })
  await prisma.bringClaim.deleteMany({ where: { rsvpId } })
  notifyLinkedToolsOfRsvps([rsvpId])
  try {
    await notifyPollOfAttendanceChange(rsvp.event, rsvp.participant.email, false)
  } catch (error) {
    console.error('Fehler bei der Abstimmungs-Benachrichtigung:', error)
  }
  await fillFreeSeats(rsvp.eventId)
  return true
}

/**
 * Cron: An der Frist werden gefragte, unbestätigte Zusagen abgesagt - nur bei Terminen mit
 * Event.reconfirmAutoDecline und nur, wer genug Zeit zum Antworten hatte (autoDeclinable). Der Gast bekommt Mail und
 * Push. Gibt die Zahl der Absagen zurück.
 */
export async function declineUnconfirmed(now: Date = new Date(), eventId?: string): Promise<number> {
  let declined = 0
  for (const event of await runningEvents(now, eventId)) {
    const window = reconfirmWindow(event)!
    if (!event.reconfirmAutoDecline || now.getTime() < window.deadline.getTime()) continue
    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id, isAttending: true, isOnWaitlist: false, reconfirmAskedAt: { not: null }, reconfirmedAt: null, hasAttended: false, shiftHelperId: null },
      include: { participant: true }
    })
    for (const rsvp of rsvps) {
      if (!autoDeclinable(rsvp, window.deadline)) continue
      if (!(await releaseSeat(rsvp.id, { reconfirmLapsedAt: now }, { reconfirmedAt: null }))) continue
      logFailures(await Promise.allSettled([
        rsvp.participant.email ? sendReconfirmLapsedEmail(rsvp.participant, event, !deadlinePassed(event, now)) : Promise.resolve(),
        sendReconfirmLapsedPush(event, rsvp.participant)
      ]), 'der Absage nach Rückbestätigung')
      declined++
    }
  }
  return declined
}

export type ReconfirmAnswer = 'confirmed' | 'declined' | 'invalid'

/**
 * Antwort des Gasts auf „Kommst du noch?“ (Knöpfe auf der Gästeseite, answerReconfirm in app/actions.ts). Berechtigt
 * ist, wer den persönlichen Link (editToken) zu einer festen Zusage GENAU dieses Termins hat, solange die
 * Rückbestätigung läuft - auch nach Frist oder Antwortfrist, eine Absage gibt den Platz frei.
 */
export async function answerReconfirmation(editToken: string, eventId: string, attending: boolean, now: Date = new Date()): Promise<ReconfirmAnswer> {
  const participant = await prisma.participant.findUnique({ where: { editToken } })
  const event = participant ? await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } }) : null
  if (!participant || !event || !reconfirmRunning(event, now)) return 'invalid'
  const rsvp = await prisma.rsvp.findUnique({ where: { eventId_participantId: { eventId, participantId: participant.id } } })
  if (!rsvp || !reconfirmApplies(rsvp, isConfirmedRsvp(rsvp, participant, effectiveRequireVerification(event)))) return 'invalid'
  if (attending) {
    const confirmed = await prisma.rsvp.updateMany({
      where: { id: rsvp.id, isAttending: true, isOnWaitlist: false },
      data: { reconfirmedAt: rsvp.reconfirmedAt ?? now, reconfirmLapsedAt: null }
    })
    return confirmed.count === 1 ? 'confirmed' : 'invalid'
  }
  return (await releaseSeat(rsvp.id, { reconfirmLapsedAt: null })) ? 'declined' : 'invalid'
}

/**
 * Termin verschoben: Wer noch nicht bestätigt hat, wird für das neue Datum erneut gefragt (die alte Frage bezog sich
 * auf das alte). Bestätigte Zusagen bleiben bestätigt.
 */
export async function resetReconfirmOnDateChange(eventId: string, before: Date, after: Date) {
  if (before.getTime() === after.getTime()) return
  await prisma.rsvp.updateMany({ where: { eventId, reconfirmedAt: null, reconfirmAskedAt: { not: null } }, data: { reconfirmAskedAt: null } })
}
