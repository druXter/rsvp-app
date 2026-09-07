// app/lib/push.ts
import webpush from 'web-push'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
