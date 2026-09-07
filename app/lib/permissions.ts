// app/lib/permissions.ts
import { PrismaClient, User, Role } from '@prisma/client'

const prisma = new PrismaClient()

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  CREATOR: 'Creator',
  MODERATOR: 'Moderator',
}

/**
 * Admins haben auf jede Ressource Owner-Rechte; ansonsten zählt nur der tatsächliche Owner.
 */
export function isOwnerOrAdmin(user: User, ownerId: string): boolean {
  return user.role === 'ADMIN' || user.id === ownerId
}

/**
 * Prüft, ob ein Nutzer über ResourceAccess Moderator-Zugriff auf ein bestimmtes Event
 * hat - entweder direkt geteilt, oder weil ihm die ganze Reihe des Events geteilt wurde.
 */
export async function hasModeratorAccess(userId: string, target: { eventId: string; seriesId?: string | null }): Promise<boolean> {
  const conditions: { eventId?: string; seriesId?: string }[] = [{ eventId: target.eventId }]
  if (target.seriesId) conditions.push({ seriesId: target.seriesId })

  const found = await prisma.resourceAccess.findFirst({
    where: { userId, OR: conditions }
  })
  return !!found
}

/**
 * Owner/Admin ODER geteilter Moderator-Zugriff auf ein Event (direkt oder via Reihe).
 * Deckt genau die Rechte ab, die Moderatoren laut Rollenkonzept haben: Gästelisten &
 * Wartelisten einsehen/bearbeiten, Check-in durchführen.
 */
export async function hasEventModeratorOrAbove(user: User, event: { ownerId: string; id: string; seriesId?: string | null }): Promise<boolean> {
  if (isOwnerOrAdmin(user, event.ownerId)) return true
  return hasModeratorAccess(user.id, { eventId: event.id, seriesId: event.seriesId })
}

/**
 * Owner/Admin ODER geteilter Moderator-Zugriff auf eine ganze Reihe (nicht auf einen
 * einzelnen Termin davon). Genutzt z.B. für addGuestUserToSeries/removeGuestUserFromSeries,
 * wo laut Rollenkonzept ausdrücklich sowohl der Creator als auch ein Moderator der Reihe
 * bestehende Nutzer-Konten zuordnen dürfen sollen.
 */
export async function hasSeriesModeratorOrAbove(user: User, series: { ownerId: string; id: string }): Promise<boolean> {
  if (isOwnerOrAdmin(user, series.ownerId)) return true
  const found = await prisma.resourceAccess.findFirst({ where: { userId: user.id, seriesId: series.id } })
  return !!found
}
