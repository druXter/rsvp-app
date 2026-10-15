// app/lib/feedback.ts
//
// Versand des Feedback-Fragebogens nach dem Event (Idee L8 Teil 2, Regeln in app/lib/feedback-link.ts): Der
// Erinnerungs-Cron (/api/cron/reminders) schickt `Event.feedbackDelayHours` Stunden nach dem Ende jeder Zusage, die
// Feedback geben darf, einmal Mail und Push mit dem Link "Feedback geben". Mail und Push gehen unabhängig voneinander,
// wie bei den Erinnerungen.
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { sendFeedbackEmail } from './mail'
import { sendFeedbackPush } from './push'
import { FEEDBACK_SEND_WINDOW_DAYS, FEEDBACK_DELAY_OPTIONS, feedbackDue, feedbackEligible, feedbackRoute, feedbackSurveyOf } from './feedback-link'

const HOUR = 60 * 60 * 1000

/**
 * Cron: alle fälligen Termine (feedbackDue), je Zusage einmal. Die Zeile wird VOR dem Versand atomar beansprucht
 * (updateMany mit feedbackSentAt null), damit zwei gleichzeitige Cron-Läufe nicht doppelt schicken - ein Fehler beim
 * Versand wird nur protokolliert, nicht wiederholt. Gibt die Zahl der angeschriebenen Zusagen zurück.
 */
export async function sendDueFeedbackRequests(now: Date = new Date()): Promise<number> {
  // Grobe Vorauswahl über den Beginn (Termine bis zu einer Woche Dauer); Dauer und Verzögerung prüft feedbackDue genau.
  const maxDelay = Math.max(...FEEDBACK_DELAY_OPTIONS.map(o => o.hours))
  const earliest = new Date(now.getTime() - (FEEDBACK_SEND_WINDOW_DAYS * 24 + maxDelay + 24 * 7) * HOUR)
  const events = await prisma.event.findMany({
    where: { feedbackUrl: { not: null }, feedbackDelayHours: { not: null }, datePending: false, date: { gte: earliest, lte: now } },
    include: { series: true }
  })

  let sent = 0
  for (const event of events) {
    if (!feedbackDue(event, now) || !feedbackSurveyOf(event)) continue
    const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id, feedbackSentAt: null, isAttending: true, isOnWaitlist: false },
      include: { participant: true }
    })
    for (const rsvp of rsvps) {
      if (!feedbackEligible(event, rsvp, rsvp.participant, requireVerification)) continue
      const claimed = await prisma.rsvp.updateMany({ where: { id: rsvp.id, feedbackSentAt: null }, data: { feedbackSentAt: now } })
      if (claimed.count !== 1) continue
      const link = `${baseUrl()}${feedbackRoute(event.id, rsvp.participant.editToken)}`
      const results = await Promise.allSettled([
        rsvp.participant.email ? sendFeedbackEmail(rsvp.participant, event, link) : Promise.resolve(),
        sendFeedbackPush(event, rsvp.participant, link)
      ])
      results.forEach(r => { if (r.status === 'rejected') console.error('Fehler beim Feedback-Versand:', r.reason) })
      sent++
    }
  }
  return sent
}
