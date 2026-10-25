// app/lib/maybe-store.ts
//
// Antwort „Vielleicht“ (Idee L26, docs/KONZEPT-VIELLEICHT.md) - Datenbank und Versand: Erinnerung zum gewählten
// Zeitpunkt, automatische Absage am Stichtag, Anpassen nach Änderungen der Verwaltung (Termin vorverlegt, Frist
// früher, Datum aus der Terminabstimmung, Schalter aus). Die Regeln selbst stehen in app/lib/maybe.ts.
//
// Invariante (performRsvpSubmission): Rsvp.maybeRemindAt ist genau dann gesetzt, wenn etwas auf „vielleicht“ steht
// (Rsvp.isMaybe oder ein RsvpPerson.isMaybe). Alles hier sucht deshalb über maybeRemindAt.
import { after } from 'next/server'
import { prisma } from './prisma'
import { formatMaybeTime, hasOpenMaybe, latestMaybeReminder, maybeCutoff } from './maybe'
import { deadlinePassed } from './rsvp-deadline'
import { sendMaybeDeclinedEmail, sendMaybeReminderEmail } from './mail'
import { sendMaybeDeclinedPush, sendMaybeReminderPush } from './push'

const WITH_DETAILS = {
  participant: true,
  event: { include: { series: true } },
  persons: { select: { name: true, isMaybe: true }, orderBy: { position: 'asc' as const } }
}

/** "Anna und Ben" - Personen eines Haushalts, die noch auf vielleicht stehen; null ohne einzelne Personen. */
function whoOf(persons: readonly { name: string | null; isMaybe: boolean }[]): string | null {
  const names = persons.filter(p => p.isMaybe).map(p => p.name || 'eine weitere Person')
  if (names.length === 0) return null
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}

function logFailures(results: PromiseSettledResult<unknown>[], what: string) {
  for (const r of results) if (r.status === 'rejected') console.error(`Fehler bei ${what}:`, r.reason)
}

/**
 * Cron: Erinnerungen, deren Zeitpunkt erreicht ist - nur mit bestätigter Adresse (ohne Bestätigung keine Erinnerung;
 * bestätigt der Gast später, kommt sie beim nächsten Lauf). Die Zeile wird VOR dem Versand atomar beansprucht, damit
 * zwei gleichzeitige Läufe nicht doppelt schicken. Nach dem Stichtag übernimmt declineExpiredMaybes.
 */
export async function sendDueMaybeReminders(now: Date = new Date(), eventId?: string): Promise<number> {
  const candidates = await prisma.rsvp.findMany({
    where: { maybeRemindAt: { lte: now }, maybeRemindedAt: null, participant: { isVerified: true, email: { not: null } }, ...(eventId ? { eventId } : {}) },
    select: { id: true, event: { select: { date: true, datePending: true, rsvpDeadline: true } } }
  })
  let sent = 0
  for (const c of candidates) {
    const cutoff = maybeCutoff(c.event)
    if (cutoff && now.getTime() >= cutoff.getTime()) continue
    const claimed = await prisma.rsvp.updateMany({ where: { id: c.id, maybeRemindedAt: null, maybeRemindAt: { not: null } }, data: { maybeRemindedAt: now } })
    if (claimed.count !== 1) continue
    const rsvp = await prisma.rsvp.findUniqueOrThrow({ where: { id: c.id }, include: WITH_DETAILS })
    if (!hasOpenMaybe(rsvp)) continue
    const who = whoOf(rsvp.persons)
    logFailures(await Promise.allSettled([
      sendMaybeReminderEmail(rsvp.participant, rsvp.event, who, cutoff),
      sendMaybeReminderPush(rsvp.event, rsvp.participant, cutoff ? formatMaybeTime(cutoff) : null)
    ]), 'der Vielleicht-Erinnerung')
    sent++
  }
  return sent
}

/**
 * Setzt alles, was in dieser Antwort auf „vielleicht“ steht, auf Absage und benachrichtigt den Gast (Mail nur an eine
 * bestätigte Adresse, Push wenn eingerichtet). Atomar über maybeRemindAt, damit niemand zweimal benachrichtigt wird.
 * Verknüpfte Tools merken davon nichts: „vielleicht“ war für sie schon eine Absage.
 */
async function endMaybe(rsvpId: string, reason: 'expired' | 'disabled', now: Date): Promise<boolean> {
  const rsvp = await prisma.rsvp.findUnique({ where: { id: rsvpId }, include: WITH_DETAILS })
  if (!rsvp) return false
  const claimed = await prisma.rsvp.updateMany({
    where: { id: rsvpId, maybeRemindAt: { not: null } },
    data: { isMaybe: false, maybeRemindAt: null, maybeRemindedAt: null }
  })
  if (claimed.count !== 1) return false
  await prisma.rsvpPerson.updateMany({ where: { rsvpId, isMaybe: true }, data: { isMaybe: false } })
  if (!hasOpenMaybe(rsvp)) return false
  const { participant, event } = rsvp
  logFailures(await Promise.allSettled([
    participant.email && participant.isVerified
      ? sendMaybeDeclinedEmail(participant, event, reason, whoOf(rsvp.persons), !deadlinePassed(event, now))
      : Promise.resolve(),
    sendMaybeDeclinedPush(event, participant)
  ]), 'der Vielleicht-Absage')
  return true
}

/** Cron: „Vielleicht“ nach dem Stichtag wird zur Absage. Gibt die Zahl der Antworten zurück. */
export async function declineExpiredMaybes(now: Date = new Date(), eventId?: string): Promise<number> {
  const candidates = await prisma.rsvp.findMany({
    where: { maybeRemindAt: { not: null }, ...(eventId ? { eventId } : {}) },
    select: { id: true, event: { select: { date: true, datePending: true, rsvpDeadline: true } } }
  })
  let declined = 0
  for (const c of candidates) {
    const cutoff = maybeCutoff(c.event)
    if (cutoff && now.getTime() >= cutoff.getTime() && (await endMaybe(c.id, 'expired', now))) declined++
  }
  return declined
}

/** Wie viele Antworten dieser Termine stehen (ganz oder teilweise) auf „vielleicht“? Für die Warnung beim Abschalten. */
export async function countOpenMaybes(eventIds: string[]): Promise<number> {
  return eventIds.length === 0 ? 0 : prisma.rsvp.count({ where: { eventId: { in: eventIds }, maybeRemindAt: { not: null } } })
}

/** Nach dem Speichern in der Verwaltung; außerhalb eines Request-Kontexts (Skripte, Tests) im Hintergrund. */
function schedule(task: () => Promise<unknown>) {
  const run = () => task().catch(error => console.error('Fehler bei „Vielleicht“:', error))
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Die Verwaltung hat „Vielleicht“ abgeschaltet: alle offenen „vielleicht“ dieser Termine werden zur Absage, die Gäste
 * bekommen Bescheid und können selbst zusagen. Gibt die Zahl zurück; der Versand läuft nach der Antwort.
 */
export async function endMaybesOnDisable(eventIds: string[]): Promise<number> {
  const rsvps = eventIds.length === 0 ? [] : await prisma.rsvp.findMany({ where: { eventId: { in: eventIds }, maybeRemindAt: { not: null } }, select: { id: true } })
  if (rsvps.length > 0) {
    schedule(async () => {
      const now = new Date()
      for (const r of rsvps) await endMaybe(r.id, 'disabled', now)
    })
  }
  return rsvps.length
}

/**
 * Termin vorverlegt, Antwortfrist früher oder Datum aus der Terminabstimmung: Erinnerungen, die jetzt zu spät lägen,
 * rücken auf den spätesten erlaubten Zeitpunkt. Liegt der schon in der Vergangenheit, geht die Erinnerung sofort raus;
 * ist auch der Stichtag vorbei, wird „vielleicht“ zur Absage. Spätere Termine ändern nichts.
 */
export async function applyMaybeScheduleChange(eventId: string, now: Date = new Date()): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true, datePending: true, rsvpDeadline: true } })
  if (!event) return
  const latest = latestMaybeReminder(event)
  if (latest) {
    await prisma.rsvp.updateMany({
      where: { eventId, maybeRemindedAt: null, maybeRemindAt: { gt: latest } },
      data: { maybeRemindAt: latest.getTime() > now.getTime() ? latest : now }
    })
  }
  schedule(async () => {
    await declineExpiredMaybes(now, eventId)
    await sendDueMaybeReminders(now, eventId)
  })
}
