// app/lib/invitation-reminder.ts
//
// Erinnerung an eingeladene Haushalte ohne Antwort (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 5): automatisch
// `Event.rsvpReminderDays` Tage vor der Antwortfrist (Cron /api/cron/reminders, je Einladung einmal pro Frist)
// oder per Knopf auf der Einladungsseite. Nur Einladungen mit E-Mail; bei offener Anmeldung gibt es niemanden,
// der noch nicht geantwortet hat.
import { prisma } from './prisma'
import { sendInvitationEmail } from './mail'
import { invitationLink } from './invitation-store'
import { formatDeadline } from './rsvp-deadline'

const DAY = 24 * 60 * 60 * 1000

/** Einladungen eines Termins mit E-Mail und ohne Antwort. */
function unanswered(eventId: string, extra: object = {}) {
  return prisma.invitation.findMany({
    where: { eventId, email: { not: null }, participant: { rsvps: { none: { eventId } } }, ...extra },
    include: { participant: true, persons: { orderBy: { position: 'asc' } }, event: true }
  })
}

/** Schickt die Erinnerung. Ein Versandfehler wird nur protokolliert (wie bei den Zahlungserinnerungen). */
async function remind(invitation: Awaited<ReturnType<typeof unanswered>>[number]): Promise<boolean> {
  try {
    await sendInvitationEmail({ ...invitation, email: invitation.email! }, invitation.event, invitationLink(invitation.event, invitation.participant), {
      reminder: true, deadline: formatDeadline(invitation.event.rsvpDeadline)
    })
  } catch (error) {
    console.error('Fehler bei der Erinnerung an eine Einladung:', error)
  }
  return true
}

/**
 * Cron: für Termine im Einladungsmodus mit Frist und Erinnerung, sobald (Frist minus rsvpReminderDays) erreicht und
 * die Frist noch nicht vorbei ist. Jede Einladung wird VOR dem Versand atomar beansprucht (reminderSentAt), damit
 * zwei gleichzeitige Läufe nicht doppelt schicken. Gibt die Zahl der Erinnerungen zurück.
 */
export async function sendDueInvitationReminders(now: Date = new Date()): Promise<number> {
  const events = await prisma.event.findMany({
    where: { inviteOnly: true, rsvpDeadline: { gt: now }, rsvpReminderDays: { not: null } },
    select: { id: true, rsvpDeadline: true, rsvpReminderDays: true }
  })
  let sent = 0
  for (const event of events) {
    if (now.getTime() < event.rsvpDeadline!.getTime() - event.rsvpReminderDays! * DAY) continue
    for (const invitation of await unanswered(event.id, { reminderSentAt: null })) {
      const claimed = await prisma.invitation.updateMany({ where: { id: invitation.id, reminderSentAt: null }, data: { reminderSentAt: now } })
      if (claimed.count === 1 && await remind(invitation)) sent++
    }
  }
  return sent
}

/** Knopf auf der Einladungsseite: Erinnerung an alle Haushalte ohne Antwort (mit E-Mail). */
export async function sendInvitationRemindersForEvent(eventId: string): Promise<number> {
  let sent = 0
  for (const invitation of await unanswered(eventId)) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { reminderSentAt: new Date() } })
    if (await remind(invitation)) sent++
  }
  return sent
}
