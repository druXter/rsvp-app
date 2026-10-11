// app/lib/invitation-reminder.ts
//
// Erinnerung an eingeladene Haushalte ohne Antwort (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 5): automatisch
// `Event.rsvpReminderDays` Tage vor der Antwortfrist (Cron /api/cron/reminders, je Einladung einmal pro Termin und
// Frist, InvitationReminder) oder per Knopf auf der Einladungsseite des Termins. Nur Einladungen mit E-Mail; bei
// offener Anmeldung gibt es niemanden, der noch nicht geantwortet hat. Bei Reihen erinnert jeder Termin für sich,
// mit dem Link direkt zum Termin.
import { prisma } from './prisma'
import { sendInvitationEmail } from './mail'
import { invitationLink, invitationsForEvent, occasionOfEvent } from './invitation-store'

const DAY = 24 * 60 * 60 * 1000

type ReminderEvent = {
  id: string; slug: string; seriesId: string | null; series: { title: string; slug: string } | null
  title: string; date: Date; datePending: boolean; location: string | null; rsvpDeadline: Date | null
}

/** Einladungen für diesen Termin mit E-Mail und ohne Antwort zu ihm. */
function unanswered(event: ReminderEvent, extra: object = {}) {
  return prisma.invitation.findMany({
    where: { AND: [invitationsForEvent(event), { email: { not: null }, participant: { rsvps: { none: { eventId: event.id } } } }, extra] },
    include: { participant: true, persons: { orderBy: { position: 'asc' } } }
  })
}

/** Schickt die Erinnerung. Ein Versandfehler wird nur protokolliert (wie bei den Zahlungserinnerungen). */
async function remind(invitation: Awaited<ReturnType<typeof unanswered>>[number], event: ReminderEvent): Promise<boolean> {
  const link = event.series ? invitationLink({ seriesSlug: event.series.slug, terminSlug: event.slug }, invitation.participant) : invitationLink(event, invitation.participant)
  try {
    await sendInvitationEmail({ ...invitation, email: invitation.email! }, occasionOfEvent(event, event.series?.title), link, { reminder: true })
  } catch (error) {
    console.error('Fehler bei der Erinnerung an eine Einladung:', error)
  }
  return true
}

/** Beansprucht die Erinnerung (Einladung, Termin) - false, wenn ein anderer Lauf schneller war. */
async function claim(invitationId: string, eventId: string, now: Date): Promise<boolean> {
  try {
    await prisma.invitationReminder.create({ data: { invitationId, eventId, sentAt: now } })
    return true
  } catch {
    return false
  }
}

/**
 * Cron: für Termine im Einladungsmodus mit Frist und Erinnerung, sobald (Frist minus rsvpReminderDays) erreicht und
 * die Frist noch nicht vorbei ist. Jede Einladung wird VOR dem Versand atomar beansprucht (InvitationReminder, der
 * Schlüssel Einladung + Termin ist eindeutig), damit zwei gleichzeitige Läufe nicht doppelt schicken. Gibt die Zahl
 * der Erinnerungen zurück.
 */
export async function sendDueInvitationReminders(now: Date = new Date()): Promise<number> {
  const events = await prisma.event.findMany({
    where: { inviteOnly: true, rsvpDeadline: { gt: now }, rsvpReminderDays: { not: null } },
    include: { series: { select: { title: true, slug: true } } }
  })
  let sent = 0
  for (const event of events) {
    if (now.getTime() < event.rsvpDeadline!.getTime() - event.rsvpReminderDays! * DAY) continue
    for (const invitation of await unanswered(event, { reminders: { none: { eventId: event.id } } })) {
      if (!(await claim(invitation.id, event.id, now))) continue
      if (await remind(invitation, event)) sent++
    }
  }
  return sent
}

/** Knopf auf der Einladungsseite eines Termins: Erinnerung an alle Haushalte ohne Antwort (mit E-Mail). */
export async function sendInvitationRemindersForEvent(eventId: string): Promise<number> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { series: { select: { title: true, slug: true } } } })
  let sent = 0
  for (const invitation of await unanswered(event)) {
    await prisma.invitationReminder.upsert({
      where: { invitationId_eventId: { invitationId: invitation.id, eventId } },
      create: { invitationId: invitation.id, eventId },
      update: { sentAt: new Date() }
    })
    if (await remind(invitation, event)) sent++
  }
  return sent
}

/** Neue Antwortfrist eines Termins: Erinnerungen gehen für die neue Frist noch einmal. */
export async function resetInvitationReminders(eventId: string) {
  await prisma.invitationReminder.deleteMany({ where: { eventId } })
}
