// app/admin/message-actions.ts
'use server'

// Nachricht an Gäste (Idee L29, Reiter „Nachrichten“, app/lib/guest-message.ts): nur Owner und Admins, wie die
// Erinnerung an alle Zusagen - eine Mail an alle Gäste ist mehr als eine Änderung an der Gästeliste. Mails gehen in
// kleinen Gruppen nacheinander raus (das Postfach verträgt keine hundert Verbindungen auf einmal), Push daneben.
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { isOwnerOrAdmin } from '../lib/permissions'
import { formString } from '../lib/form'
import {
  describeAudience, MAX_MESSAGE_BODY, MAX_MESSAGE_SUBJECT, MAX_MESSAGES_PER_DAY, messageParagraphs, readAudience, selectRecipients
} from '../lib/guest-message'
import { sendGuestMessageEmail } from '../lib/mail'
import { sendGuestMessagePush } from '../lib/push'
import type { SettingsState } from './actions'

/** So viele Mails gleichzeitig - danach die nächsten. */
const MAIL_BATCH = 5

async function inBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  for (let i = 0; i < items.length; i += size) results.push(...await Promise.allSettled(items.slice(i, i + size).map(run)))
  return results
}

export async function sendGuestMessage(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const event = await prisma.event.findUnique({
    where: { id: formString(formData, 'eventId', 50) },
    include: { series: true, ticketCategories: { select: { id: true, label: true } }, rsvps: { include: { participant: true } } }
  })
  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return { error: 'Termin nicht gefunden.' }

  const rawSubject = formData.get('subject')
  const rawBody = formData.get('body')
  if (typeof rawSubject !== 'string' || typeof rawBody !== 'string') return { error: 'Bitte Betreff und Text ausfüllen.' }
  // Kein Zeilenumbruch im Betreff (Kopfzeile der Mail); zu lang = Fehler statt still gekürzt
  const subject = rawSubject.replace(/\s+/g, ' ').trim()
  const body = rawBody.replace(/\r\n?/g, '\n').trim()
  if (!subject || !body) return { error: 'Bitte Betreff und Text ausfüllen.' }
  if (subject.length > MAX_MESSAGE_SUBJECT) return { error: `Der Betreff ist zu lang (höchstens ${MAX_MESSAGE_SUBJECT} Zeichen).` }
  if (body.length > MAX_MESSAGE_BODY) return { error: `Der Text ist zu lang (höchstens ${MAX_MESSAGE_BODY} Zeichen).` }
  const audience = readAudience(formData, event.ticketCategories.map(c => c.id))
  if (!audience) return { error: 'Bitte mindestens eine Gruppe wählen (Zusagen, Warteliste oder Vielleicht).' }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  if (await prisma.guestMessage.count({ where: { eventId: event.id, createdAt: { gte: since } } }) >= MAX_MESSAGES_PER_DAY) {
    return { error: `Höchstens ${MAX_MESSAGES_PER_DAY} Nachrichten pro Termin in 24 Stunden.` }
  }
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const { all, mail } = selectRecipients(event.rsvps, audience, requireVerification)
  if (all.length === 0) return { error: 'Die Auswahl enthält niemanden - nichts verschickt.' }

  // Zuerst festhalten: Auch ein Versand, der unterwegs abbricht, zählt zur Grenze und steht im Verlauf
  const categoryLabel = event.ticketCategories.find(c => c.id === audience.categoryId)?.label ?? null
  const message = await prisma.guestMessage.create({
    data: {
      eventId: event.id, subject, body, audience: JSON.stringify(audience), audienceText: describeAudience(audience, categoryLabel),
      recipients: all.length, mailSent: 0, mailFailed: 0, authorEmail: user.email
    }
  })
  const paragraphs = messageParagraphs(body)
  const [mailResults] = await Promise.all([
    inBatches(mail, MAIL_BATCH, rsvp => sendGuestMessageEmail(event, rsvp.participant, subject, paragraphs)),
    Promise.allSettled(all.map(rsvp => sendGuestMessagePush(event, rsvp.participant, subject)))
  ])
  const mailSent = mailResults.filter(r => r.status === 'fulfilled' && r.value).length
  await prisma.guestMessage.update({ where: { id: message.id }, data: { mailSent, mailFailed: mail.length - mailSent } })

  revalidatePath(`/admin/events/${event.id}/nachrichten`)
  redirect(`/admin/events/${event.id}/nachrichten?gesendet=${message.id}`)
}
