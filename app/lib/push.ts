// app/lib/push.ts
import webpush from 'web-push'
import { PrismaClient, Event, EventSeries, Participant } from '@prisma/client'
import { personalEventLink } from './mail'

const prisma = new PrismaClient()

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

/**
 * Schickt eine Push-Benachrichtigung an alle Geräte EINES BESTIMMTEN Nutzers (z.B. des
 * Event-Owners) - nie an fremde Nutzer. Abgelaufene/ungültige Abos (HTTP 404/410 vom
 * Push-Dienst) werden dabei automatisch aus der Datenbank entfernt.
 */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  ensureVapidConfigured()
  if (!vapidConfigured) return // Keine VAPID-Keys konfiguriert -> Feature bleibt inaktiv

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      ).catch(async (error) => {
        // 404/410 = Browser hat das Abo beendet (z.B. Cache geleert) - dauerhaft ungültig
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
        throw error
      })
    )
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.error(`Push-Versand: ${failed}/${subscriptions.length} fehlgeschlagen`)
  }
}

/**
 * Schickt eine Push-Benachrichtigung an alle Geräte EINES BESTIMMTEN Gasts (Participant,
 * siehe subscribeParticipantToPush in app/actions.ts) - z.B. für Erinnerungen oder
 * Termin-Änderungen. Bewusst getrennt von sendPushToUser (admin-seitig): Gast-Push hängt
 * an der Participant-Identität, nicht an einem GuestUser-Konto, damit auch anonyme
 * editToken-Gäste ohne Konto Push abonnieren können. Abgelaufene/ungültige Abos werden
 * wie bei sendPushToUser automatisch entfernt.
 */
export async function sendPushToParticipant(participantId: string, payload: { title: string; body: string; url?: string }) {
  ensureVapidConfigured()
  if (!vapidConfigured) return // Keine VAPID-Keys konfiguriert -> Feature bleibt inaktiv

  const subscriptions = await prisma.participantPushSubscription.findMany({ where: { participantId } })
  if (subscriptions.length === 0) return

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      ).catch(async (error) => {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await prisma.participantPushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
        throw error
      })
    )
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.error(`Gast-Push-Versand: ${failed}/${subscriptions.length} fehlgeschlagen`)
  }
}

/**
 * Push-Pendant zu sendReminderEmail (app/lib/mail.ts) - gleicher Anlass (manueller
 * sendReminder-Admin-Action oder der automatische /api/cron/reminders-Endpunkt), nur als
 * Push statt/zusätzlich zur E-Mail. Verlinkt über denselben personalEventLink() wie die
 * Mail, damit ein Tap auf die Benachrichtigung direkt auf der richtigen Termin-Seite
 * landet (Reihen-Route bei einem Reihen-Termin, sonst der Einzel-Event-Slug).
 */
export async function sendReminderPush(event: EventWithSeries, participant: Participant) {
  const formattedDate = new Date(event.date).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
  await sendPushToParticipant(participant.id, {
    title: `⏰ Erinnerung: ${event.title}`,
    body: `${formattedDate} Uhr${event.location ? ' · ' + event.location : ''}`,
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
