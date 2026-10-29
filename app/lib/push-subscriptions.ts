// app/lib/push-subscriptions.ts
//
// Lebenszyklus der Push-Abos (Gast: ParticipantPushSubscription, Teilnehmendenkonto: GuestUserPushSubscription,
// Verwaltung: PushSubscription) jenseits von An- und Abmelden:
// - Wer eine Gast-Benachrichtigung bekommt, ergibt sich erst beim Versand (pushRecipientsForParticipant): die Abos des
//   Participants, die des ganzen Kontos und die des verknüpften Verwaltungskontos - so gilt ein Konto-Abo auch für
//   Termine, die erst später dazukommen.
// - Lehnt der Push-Dienst ein Abo mit 404/410 ab, wird es als abgelaufen markiert (markEndpointExpired), nicht
//   gelöscht - in allen Tabellen, denn ein Endpoint gehört zu genau einem Browser.
// - Beim Laden einer Seite fragt der Browser nach dem Stand seines Abos (pushStatus, /api/push/status). Ist es
//   abgelaufen, holt er ein neues und ersetzt das alte (replaceEndpoint, /api/push/resubscribe) - ebenso der Service
//   Worker bei `pushsubscriptionchange` (public/sw.js).
// - Der Cleanup-Cron löscht abgelaufene Zeilen nach EXPIRED_PUSH_RETENTION_DAYS.
import { prisma } from './prisma'

export const EXPIRED_PUSH_RETENTION_DAYS = 90

/**
 * Stand eines Abos aus Sicht des Servers: aktiv, über ein umfassenderes Abo abgedeckt (das Konto bzw. das verknüpfte
 * Verwaltungskonto bekommt auf diesem Gerät ohnehin alles), abgelaufen (Browser soll ein neues holen) oder nicht
 * gespeichert.
 */
export type PushStatus = 'active' | 'covered' | 'expired' | 'none'
type RowStatus = 'active' | 'expired' | 'none'

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

/** Markiert einen Endpoint in allen Tabellen als abgelaufen (kein Versand mehr, bis das Gerät ihn ersetzt). */
export async function markEndpointExpired(endpoint: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.participantPushSubscription.updateMany({ where: { endpoint, expiredAt: null }, data: { expiredAt: now } }),
    prisma.guestUserPushSubscription.updateMany({ where: { endpoint, expiredAt: null }, data: { expiredAt: now } }),
    prisma.pushSubscription.updateMany({ where: { endpoint, expiredAt: null }, data: { expiredAt: now } })
  ])
}

/**
 * Alle Geräte, die eine Benachrichtigung an diesen Gast bekommen: seine eigenen Abos, die Abos seines
 * Teilnehmendenkontos und die des damit verknüpften Verwaltungskontos - ohne abgelaufene, jedes Gerät nur einmal.
 */
export async function pushRecipientsForParticipant(participantId: string): Promise<StoredKeys[]> {
  const participant = await prisma.participant.findUnique({ where: { id: participantId }, select: { guestUserId: true } })
  if (!participant) return []
  const guestUserId = participant.guestUserId
  const select = { endpoint: true, p256dh: true, auth: true }
  const [own, account, linkedUser] = await Promise.all([
    prisma.participantPushSubscription.findMany({ where: { participantId, expiredAt: null }, select }),
    guestUserId ? prisma.guestUserPushSubscription.findMany({ where: { guestUserId, expiredAt: null }, select }) : [],
    guestUserId ? prisma.pushSubscription.findMany({ where: { user: { linkedGuestUserId: guestUserId }, expiredAt: null }, select }) : []
  ])
  return [...new Map([...own, ...account, ...linkedUser].map(sub => [sub.endpoint, sub])).values()]
}

function statusOf(row: { expiredAt: Date | null } | null): RowStatus {
  if (!row) return 'none'
  return row.expiredAt ? 'expired' : 'active'
}

/**
 * Fasst das eigene Abo eines Schalters und ein umfassenderes zusammen, das dasselbe Gerät schon abdeckt: Ist das
 * umfassendere aktiv, heißt das `covered` (der Schalter könnte nichts abschalten); sonst zählt das eigene. Ein
 * abgelaufenes - egal welches - lässt den Browser ein neues Abo holen, das dann beide ersetzt.
 */
export function combinePushStatus(own: RowStatus, cover: RowStatus): PushStatus {
  if (cover === 'active') return 'covered'
  if (own === 'active') return 'active'
  if (own === 'expired' || cover === 'expired') return 'expired'
  return 'none'
}

function bestOf(rows: { expiredAt: Date | null }[]): RowStatus {
  if (rows.some(row => !row.expiredAt)) return 'active'
  return rows.length > 0 ? 'expired' : 'none'
}

/** Deckt das Konto (Konto-Abo oder verknüpftes Verwaltungskonto) dieses Gerät schon ab? */
async function accountCover(guestUserId: string | null, endpoint: string, options: { includeOwnAccount: boolean }): Promise<RowStatus> {
  if (!guestUserId) return 'none'
  const [account, linkedUser] = await Promise.all([
    options.includeOwnAccount ? prisma.guestUserPushSubscription.findMany({ where: { guestUserId, endpoint }, select: { expiredAt: true } }) : [],
    prisma.pushSubscription.findMany({ where: { endpoint, user: { linkedGuestUserId: guestUserId } }, select: { expiredAt: true } })
  ])
  return bestOf([...account, ...linkedUser])
}

/** Stand des Abos eines Geräts für einen Gast (Participant), samt Abdeckung über sein Konto. */
export async function participantPushStatus(participant: { id: string; guestUserId: string | null }, endpoint: string): Promise<PushStatus> {
  const [own, cover] = await Promise.all([
    prisma.participantPushSubscription.findUnique({
      where: { participantId_endpoint: { participantId: participant.id, endpoint } },
      select: { expiredAt: true }
    }),
    accountCover(participant.guestUserId, endpoint, { includeOwnAccount: true })
  ])
  return combinePushStatus(statusOf(own), cover)
}

/** Stand des Konto-Abos eines Geräts für ein Teilnehmendenkonto, samt Abdeckung über das verknüpfte Verwaltungskonto. */
export async function guestUserPushStatus(guestUserId: string, endpoint: string): Promise<PushStatus> {
  const [own, cover] = await Promise.all([
    prisma.guestUserPushSubscription.findUnique({ where: { guestUserId_endpoint: { guestUserId, endpoint } }, select: { expiredAt: true } }),
    accountCover(guestUserId, endpoint, { includeOwnAccount: false })
  ])
  return combinePushStatus(statusOf(own), cover)
}

/** Stand des Abos eines Geräts für ein Verwaltungskonto. */
export async function userPushStatus(userId: string, endpoint: string): Promise<PushStatus> {
  return statusOf(await prisma.pushSubscription.findFirst({ where: { endpoint, userId }, select: { expiredAt: true } }))
}

/**
 * Bekommt dieses Teilnehmendenkonto überhaupt Push - über ein Abo eines seiner Participants, ein Konto-Abo oder das
 * verknüpfte Verwaltungskonto? Voraussetzung dafür, auf Bestätigungs-Mails zu verzichten.
 */
export async function guestUserHasPush(guestUserId: string): Promise<boolean> {
  const [own, account, linkedUser] = await Promise.all([
    prisma.participantPushSubscription.count({ where: { participant: { guestUserId }, expiredAt: null } }),
    prisma.guestUserPushSubscription.count({ where: { guestUserId, expiredAt: null } }),
    prisma.pushSubscription.count({ where: { user: { linkedGuestUserId: guestUserId }, expiredAt: null } })
  ])
  return own + account + linkedUser > 0
}

/**
 * Ersetzt einen Endpoint durch ein neues Abo desselben Browsers - in allen Tabellen, für alle Gäste und Konten,
 * die ihn gespeichert haben (der Browser hat genau EIN Abo pro Service Worker). Berechtigt ist, wer den alten
 * Endpoint kennt: Das ist eine nicht erratbare Adresse, die nur der Browser selbst und dieser Server kennen.
 * Gibt die Zahl der ersetzten Zeilen zurück (0: alter Endpoint unbekannt, nichts passiert).
 */
export async function replaceEndpoint(oldEndpoint: string, next: StoredKeys): Promise<number> {
  if (oldEndpoint === next.endpoint) {
    const data = { p256dh: next.p256dh, auth: next.auth, expiredAt: null }
    const [guests, accounts, users] = await prisma.$transaction([
      prisma.participantPushSubscription.updateMany({ where: { endpoint: oldEndpoint }, data }),
      prisma.guestUserPushSubscription.updateMany({ where: { endpoint: oldEndpoint }, data }),
      prisma.pushSubscription.updateMany({ where: { endpoint: oldEndpoint }, data })
    ])
    return guests.count + accounts.count + users.count
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
    const accounts = await tx.guestUserPushSubscription.findMany({ where: { endpoint: oldEndpoint }, select: { id: true, guestUserId: true } })
    for (const row of accounts) {
      await tx.guestUserPushSubscription.upsert({
        where: { guestUserId_endpoint: { guestUserId: row.guestUserId, endpoint: next.endpoint } },
        update: { p256dh: next.p256dh, auth: next.auth, expiredAt: null },
        create: { guestUserId: row.guestUserId, ...next }
      })
      await tx.guestUserPushSubscription.delete({ where: { id: row.id } })
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
