// app/lib/push.ts
import { formatEventDate } from './event-date'
import webpush from 'web-push'
import { Event, EventSeries, Participant } from '@prisma/client'
import { prisma } from './prisma'
import { personalEventLink } from './mail'
import { describePushError, isExpiredPushError, markEndpointExpired, pushRecipientsForParticipant } from './push-subscriptions'


// Ein Event, das optional (bei Reihen-Terminen) seine EventSeries mitbringt - gleiche
// Definition wie in app/lib/mail.ts, da personalEventLink() das braucht.
type EventWithSeries = Event & { series?: EventSeries | null }

let vapidConfigured = false

function ensureVapidConfigured() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
}

type PushPayload = { title: string; body: string; url?: string }

/**
 * Schickt an die übergebenen Abos und protokolliert jeden Fehler einzeln mit Statuscode, Push-Dienst und Empfänger
 * (`label`, nur Kennungen). Abos, die der Push-Dienst mit 404/410 ablehnt, werden als abgelaufen markiert
 * (app/lib/push-subscriptions.ts) - das Gerät ersetzt sie beim nächsten Seitenbesuch selbst.
 */
async function deliver(label: string, subscriptions: { endpoint: string; p256dh: string; auth: string }[], payload: PushPayload) {
  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload))
    )
  )
  await Promise.all(results.map(async (result, i) => {
    if (result.status === 'fulfilled') return
    const endpoint = subscriptions[i].endpoint
    if (isExpiredPushError(result.reason)) await markEndpointExpired(endpoint).catch(() => {})
    console.error(`${label}: ${describePushError(endpoint, result.reason)}`)
  }))
}

/**
 * Schickt eine Push-Benachrichtigung an alle Geräte EINES BESTIMMTEN Nutzers (z.B. des
 * Event-Owners) - nie an fremde Nutzer. Abgelaufene Abos (expiredAt) bekommen nichts.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  ensureVapidConfigured()
  if (!vapidConfigured) return // Keine VAPID-Keys konfiguriert -> Feature bleibt inaktiv

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId, expiredAt: null } })
  if (subscriptions.length === 0) return
  await deliver(`Push an Konto ${userId}`, subscriptions, payload)
}

/**
 * Schickt eine Push-Benachrichtigung an alle Geräte EINES BESTIMMTEN Gasts (Participant,
 * siehe subscribeParticipantToPush in app/actions.ts) - z.B. für Erinnerungen oder
 * Termin-Änderungen. Bewusst getrennt von sendPushToUser (admin-seitig): Gast-Push hängt
 * an der Participant-Identität, nicht an einem GuestUser-Konto, damit auch anonyme
 * editToken-Gäste ohne Konto Push abonnieren können. Gehört der Gast zu einem Konto, gehen
 * zusätzlich dessen Konto-Abos ("Push für alle Termine") und die Geräte des verknüpften
 * Verwaltungskontos mit (pushRecipientsForParticipant). Abgelaufene Abos bekommen nichts.
 */
export async function sendPushToParticipant(participantId: string, payload: PushPayload) {
  ensureVapidConfigured()
  if (!vapidConfigured) return // Keine VAPID-Keys konfiguriert -> Feature bleibt inaktiv

  const subscriptions = await pushRecipientsForParticipant(participantId)
  if (subscriptions.length === 0) return
  await deliver(`Gast-Push an Participant ${participantId}`, subscriptions, payload)
}

/**
 * Push-Pendant zu sendReminderEmail (app/lib/mail.ts) - gleicher Anlass (manueller
 * sendReminder-Admin-Action oder der automatische /api/cron/reminders-Endpunkt), nur als
 * Push statt/zusätzlich zur E-Mail. Verlinkt über denselben personalEventLink() wie die
 * Mail, damit ein Tap auf die Benachrichtigung direkt auf der richtigen Termin-Seite
 * landet (Reihen-Route bei einem Reihen-Termin, sonst der Einzel-Event-Slug).
 */
export async function sendReminderPush(event: EventWithSeries, participant: Participant) {
  const formattedDate = formatEventDate(event, 'short')
  await sendPushToParticipant(participant.id, {
    title: `⏰ Erinnerung: ${event.title}`,
    body: `${formattedDate}${event.location ? ' · ' + event.location : ''}`,
    url: personalEventLink(event, participant)
  })
}

/**
 * Push-Pendant zu sendEventUpdatedEmail (app/lib/mail.ts) - wird von
 * notifyAttendeesOfChange (app/admin/actions.ts) parallel zur Änderungs-Mail verschickt,
 * wenn ein Admin/Creator "Teilnehmende benachrichtigen" angehakt hat.
 */
export async function sendEventChangedPush(
  event: EventWithSeries,
  participant: Participant,
  changes: { label: string; detail: string }[]
) {
  await sendPushToParticipant(participant.id, {
    title: `⚠️ Änderung: ${event.title}`,
    body: `Geändert: ${changes.map(c => c.label).join(', ')}`,
    url: personalEventLink(event, participant)
  })
}

/** Nachricht an Gäste (Idee L29) - neben der Mail, mit dem Betreff als Text. */
export async function sendGuestMessagePush(event: EventWithSeries, participant: Participant, subject: string) {
  await sendPushToParticipant(participant.id, {
    title: `✉️ ${event.title}`,
    body: subject,
    url: personalEventLink(event, participant)
  })
}

/** Zahlungserinnerung (app/lib/payment-reminder.ts) - neben der Mail, wie alle Erinnerungen. */
export async function sendPaymentReminderPush(event: EventWithSeries, participant: Participant, amount: string, dueAt: string | null) {
  await sendPushToParticipant(participant.id, {
    title: `💶 Zahlung offen: ${event.title}`,
    body: `${amount}${dueAt ? ` · bitte bis ${dueAt} überweisen` : ''}`,
    url: personalEventLink(event, participant)
  })
}

/** Feedback nach dem Event (app/lib/feedback.ts) - neben der Mail, wie alle Erinnerungen. */
export async function sendFeedbackPush(event: EventWithSeries, participant: Participant, link: string) {
  await sendPushToParticipant(participant.id, {
    title: `📝 Wie war's? ${event.title}`,
    body: 'Ein kurzer Fragebogen, ohne Namen.',
    url: link
  })
}

/**
 * Push-Pendant zu sendConfirmationEmail (app/lib/mail.ts) - wird ANSTELLE der
 * Bestätigungs-Mail verschickt, wenn der Gast in seinem Nutzer-Konto
 * (GuestUser.disableConfirmationEmails, siehe /mein-konto/account) festgelegt hat, keine
 * Bestätigungs-Mails mehr zu wollen, weil ihm die Info ohnehin per PWA-Push angezeigt wird
 * (siehe shouldSuppressConfirmationEmail in app/actions.ts). Wie sendConfirmationEmail wird
 * sie nie für Wartelisten-Fälle aufgerufen (dafür bleibt sendWaitlistEmail zuständig). Anders
 * als die Mail enthält sie bewusst keinen .ics-Anhang und keinen QR-Check-in-Code - beides
 * bleibt über den verlinkten personalEventLink() auf der Termin-Seite abrufbar.
 */
export async function sendConfirmationPush(event: EventWithSeries, participant: Participant) {
  const formattedDate = formatEventDate(event, 'short')
  await sendPushToParticipant(participant.id, {
    title: `✅ Zusage bestätigt: ${event.title}`,
    body: `${formattedDate}${event.location ? ' · ' + event.location : ''}`,
    url: personalEventLink(event, participant)
  })
}

/** Erinnerung bei „Vielleicht“ (app/lib/maybe-store.ts) - neben der Mail. */
export async function sendMaybeReminderPush(event: EventWithSeries, participant: Participant, cutoff: string | null) {
  await sendPushToParticipant(participant.id, {
    title: `🤔 Kommst du? ${event.title}`,
    body: `Bitte sag zu oder ab${cutoff ? ` - bis ${cutoff}` : ''}.`,
    url: personalEventLink(event, participant)
  })
}

/** „Vielleicht“ wurde zur Absage (Stichtag oder abgeschaltet) - neben der Mail. */
export async function sendMaybeDeclinedPush(event: EventWithSeries, participant: Participant) {
  await sendPushToParticipant(participant.id, {
    title: `Als abgesagt eingetragen: ${event.title}`,
    body: '„Vielleicht“ gilt jetzt als Absage.',
    url: personalEventLink(event, participant)
  })
}

/** Rückbestätigung (app/lib/reconfirm-store.ts) - neben der Mail. */
export async function sendReconfirmRequestPush(event: EventWithSeries, participant: Participant, deadline: string) {
  await sendPushToParticipant(participant.id, {
    title: `Kommst du noch? ${event.title}`,
    body: `Bitte bestätige deine Zusage oder sag ab - bis ${deadline}.`,
    url: personalEventLink(event, participant)
  })
}

/** Rückbestätigung ohne Antwort: Platz freigegeben - neben der Mail. */
export async function sendReconfirmLapsedPush(event: EventWithSeries, participant: Participant) {
  await sendPushToParticipant(participant.id, {
    title: `Platz freigegeben: ${event.title}`,
    body: 'Deine Zusage war bis zur Frist nicht bestätigt.',
    url: personalEventLink(event, participant)
  })
}

/** Erreicht eine Push-Benachrichtigung diesen Gast überhaupt (VAPID eingerichtet, mindestens ein gültiges Abo)? */
export async function canPushParticipant(participantId: string): Promise<boolean> {
  ensureVapidConfigured()
  return vapidConfigured && (await pushRecipientsForParticipant(participantId)).length > 0
}
