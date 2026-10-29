// app/lib/push-subscriptions.ts
//
// Lebenszyklus der Push-Abos (Gast: ParticipantPushSubscription, Verwaltung: PushSubscription) jenseits von An- und
// Abmelden:
// - Lehnt der Push-Dienst ein Abo mit 404/410 ab, wird es als abgelaufen markiert (markEndpointExpired), nicht
//   gelöscht - in beiden Tabellen, denn ein Endpoint gehört zu genau einem Browser.
// - Beim Laden einer Seite fragt der Browser nach dem Stand seines Abos (pushStatus, /api/push/status). Ist es
//   abgelaufen, holt er ein neues und ersetzt das alte (replaceEndpoint, /api/push/resubscribe) - ebenso der Service
//   Worker bei `pushsubscriptionchange` (public/sw.js).
// - Der Cleanup-Cron löscht abgelaufene Zeilen nach EXPIRED_PUSH_RETENTION_DAYS.
import { prisma } from './prisma'

export const EXPIRED_PUSH_RETENTION_DAYS = 90

/** Stand eines Abos aus Sicht des Servers: aktiv, abgelaufen (Browser soll ein neues holen) oder nicht gespeichert. */
export type PushStatus = 'active' | 'expired' | 'none'

export type StoredKeys = { endpoint: string; p256dh: string; auth: string }

/** 404/410 vom Push-Dienst: Das Abo ist dauerhaft ungültig (Browser hat es beendet, Websitedaten gelöscht ...). */
export function isExpiredPushError(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return status === 404 || status === 410
}

/** Kurzbeschreibung eines Versandfehlers für das Log - ohne Endpoint (der wirkt wie ein Geheimnis), nur dessen Host. */
export function describePushError(endpoint: string, error: unknown): string {
  let host = 'unbekannter Dienst'
  try {
    host = new URL(endpoint).host
  } catch {}
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  const message = error instanceof Error ? error.message : String(error)
  if (isExpiredPushError(error)) return `${host} ${status} (Abo abgelaufen, als abgelaufen markiert)`
  return `${host} ${typeof status === 'number' ? status : 'ohne Status'} (${message.slice(0, 200)})`
}

/** Markiert einen Endpoint in beiden Tabellen als abgelaufen (kein Versand mehr, bis das Gerät ihn ersetzt). */
export async function markEndpointExpired(endpoint: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.participantPushSubscription.updateMany({ where: { endpoint, expiredAt: null }, data: { expiredAt: now } }),
    prisma.pushSubscription.updateMany({ where: { endpoint, expiredAt: null }, data: { expiredAt: now } })
  ])
}

function statusOf(row: { expiredAt: Date | null } | null): PushStatus {
  if (!row) return 'none'
  return row.expiredAt ? 'expired' : 'active'
}

/** Stand des Abos eines Geräts für einen Gast (Participant). */
export async function participantPushStatus(participantId: string, endpoint: string): Promise<PushStatus> {
  return statusOf(await prisma.participantPushSubscription.findUnique({
    where: { participantId_endpoint: { participantId, endpoint } },
    select: { expiredAt: true }
  }))
}

/** Stand des Abos eines Geräts für ein Verwaltungskonto. */
export async function userPushStatus(userId: string, endpoint: string): Promise<PushStatus> {
  return statusOf(await prisma.pushSubscription.findFirst({ where: { endpoint, userId }, select: { expiredAt: true } }))
}

/**
 * Ersetzt einen Endpoint durch ein neues Abo desselben Browsers - in beiden Tabellen, für alle Gäste und Konten,
 * die ihn gespeichert haben (der Browser hat genau EIN Abo pro Service Worker). Berechtigt ist, wer den alten
 * Endpoint kennt: Das ist eine nicht erratbare Adresse, die nur der Browser selbst und dieser Server kennen.
 * Gibt die Zahl der ersetzten Zeilen zurück (0: alter Endpoint unbekannt, nichts passiert).
 */
export async function replaceEndpoint(oldEndpoint: string, next: StoredKeys): Promise<number> {
  if (oldEndpoint === next.endpoint) {
    const [guests, users] = await prisma.$transaction([
      prisma.participantPushSubscription.updateMany({ where: { endpoint: oldEndpoint }, data: { p256dh: next.p256dh, auth: next.auth, expiredAt: null } }),
      prisma.pushSubscription.updateMany({ where: { endpoint: oldEndpoint }, data: { p256dh: next.p256dh, auth: next.auth, expiredAt: null } })
    ])
    return guests.count + users.count
  }

  return prisma.$transaction(async tx => {
    let replaced = 0
    const guests = await tx.participantPushSubscription.findMany({ where: { endpoint: oldEndpoint }, select: { id: true, participantId: true } })
    for (const row of guests) {
      await tx.participantPushSubscription.upsert({
        where: { participantId_endpoint: { participantId: row.participantId, endpoint: next.endpoint } },
        update: { p256dh: next.p256dh, auth: next.auth, expiredAt: null },
        create: { participantId: row.participantId, ...next }
      })
      await tx.participantPushSubscription.delete({ where: { id: row.id } })
      replaced++
    }
    const user = await tx.pushSubscription.findUnique({ where: { endpoint: oldEndpoint }, select: { id: true, userId: true } })
    if (user) {
      // endpoint ist hier eindeutig: Gehört der neue schon jemandem, gewinnt das Konto des alten Abos.
      await tx.pushSubscription.deleteMany({ where: { endpoint: next.endpoint } })
      await tx.pushSubscription.update({ where: { id: user.id }, data: { ...next, expiredAt: null } })
      replaced++
    }
    return replaced
  })
}
