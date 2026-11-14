// app/lib/guest-retention-store.ts
import { prisma } from './prisma'

/**
 * Löscht Teilnehmendenkonten vollständig: Antworten und Participants des Kontos (über alle Reihen), Push-Abos,
 * Mitgliedschaften, Sitzungen, API-Token, Freigaben. Einladungen und Konto-Push hängen per Cascade, die Verknüpfung
 * mit einem Verwaltungskonto per SetNull. Für den Aufräum-Cron; verknüpften Tools meldet er nichts (dokumentiert).
 */
export async function deleteGuestUsers(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  await prisma.rsvp.deleteMany({ where: { participant: { guestUserId: { in: ids } } } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { guestUserId: { in: ids } } } })
  await prisma.participant.deleteMany({ where: { guestUserId: { in: ids } } })
  await prisma.guestUserSeries.deleteMany({ where: { guestUserId: { in: ids } } })
  await prisma.guestSession.deleteMany({ where: { guestUserId: { in: ids } } })
  await prisma.guestApiToken.deleteMany({ where: { guestUserId: { in: ids } } })
  await prisma.guestToolConsent.deleteMany({ where: { guestUserId: { in: ids } } })
  return (await prisma.guestUser.deleteMany({ where: { id: { in: ids } } })).count
}
