// app/lib/payment-reminder.ts
//
// Zahlungserinnerungen (docs/KONZEPT-TICKETS.md): automatisch `Event.paymentReminderDays` Tage vor Ablauf der
// Frist (Cron /api/cron/reminders, je Zusage einmal pro Frist) oder per Knopf in der Verwaltung an alle offenen
// Zahlungen eines Termins. Mail und Push gehen unabhängig voneinander, wie bei den Event-Erinnerungen.
import { prisma } from './prisma'
import { sendPaymentReminderEmail } from './mail'
import { sendPaymentReminderPush } from './push'
import { formatEuro, formatPaymentDate, paymentDue } from './payment-state'

const DAY = 24 * 60 * 60 * 1000

/** Schickt einer Zusage die Erinnerung, sofern noch eine Zahlung fällig ist. Fehler beim Versand werden nur protokolliert. */
async function remind(rsvpId: string): Promise<boolean> {
  const rsvp = await prisma.rsvp.findUnique({ where: { id: rsvpId }, include: { participant: true, event: { include: { series: true } } } })
  if (!rsvp || !paymentDue(rsvp) || !rsvp.amountCents) return false
  const dueAt = rsvp.paymentDueAt ? formatPaymentDate(rsvp.paymentDueAt) : null
  await Promise.allSettled([
    rsvp.participant.email ? sendPaymentReminderEmail(rsvp.participant, rsvp, rsvp.event) : Promise.resolve(),
    sendPaymentReminderPush(rsvp.event, rsvp.participant, formatEuro(rsvp.amountCents), dueAt)
  ]).then(results => results.forEach(r => { if (r.status === 'rejected') console.error('Fehler bei der Zahlungserinnerung:', r.reason) }))
  return true
}

/**
 * Cron: alle Zusagen mit offener Zahlung, deren Termin eine automatische Erinnerung hat und deren Zeitpunkt
 * (Frist minus paymentReminderDays) erreicht ist - je Frist nur einmal. Die Zeile wird VOR dem Versand atomar
 * beansprucht (updateMany mit paymentReminderSentAt null), damit zwei gleichzeitige Cron-Läufe nicht doppelt
 * schicken. Gibt die Zahl der Erinnerungen zurück.
 */
export async function sendDuePaymentReminders(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.rsvp.findMany({
    where: {
      isAttending: true,
      isOnWaitlist: false,
      paidAt: null,
      amountCents: { gt: 0 },
      paymentDueAt: { not: null },
      paymentReminderSentAt: null,
      event: { paymentReminderDays: { not: null } }
    },
    select: { id: true, paymentDueAt: true, event: { select: { paymentReminderDays: true } } }
  })
  let sent = 0
  for (const c of candidates) {
    if (now.getTime() < c.paymentDueAt!.getTime() - c.event.paymentReminderDays! * DAY) continue
    const claimed = await prisma.rsvp.updateMany({ where: { id: c.id, paymentReminderSentAt: null }, data: { paymentReminderSentAt: now } })
    if (claimed.count === 1 && await remind(c.id)) sent++
  }
  return sent
}

/** Knopf in der Verwaltung: Erinnerung an alle Zusagen des Termins mit offener oder überfälliger Zahlung. */
export async function sendPaymentRemindersForEvent(eventId: string): Promise<number> {
  const rsvps = await prisma.rsvp.findMany({ where: { eventId, isAttending: true, isOnWaitlist: false, paidAt: null, amountCents: { gt: 0 } } })
  let sent = 0
  for (const r of rsvps.filter(r => paymentDue(r))) {
    await prisma.rsvp.update({ where: { id: r.id }, data: { paymentReminderSentAt: new Date() } })
    if (await remind(r.id)) sent++
  }
  return sent
}
