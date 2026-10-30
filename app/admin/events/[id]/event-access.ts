// app/admin/events/[id]/event-access.ts
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove, isOwnerOrAdmin } from '../../../lib/permissions'
import { invitationsForEvent } from '../../../lib/invitation-store'

/**
 * Event der Event-Seite samt Rechten - einmal pro Anfrage (cache), geteilt von Layout und Reitern. null, wenn es
 * das Event nicht gibt oder das Konto keinen Zugriff hat (Seite antwortet dann mit 404). Ohne Login zum Login.
 */
export const loadAdminEvent = cache(async (id: string) => {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      series: true,
      owner: { select: { email: true } },
      _count: { select: { invitations: true, ticketCategories: true, menuCourses: true, rsvps: true, bringSlots: true, wishes: true, presenceEntries: true } }
    }
  })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return null
  // Einladungen, die für den Termin gelten: eigene bzw. bei Reihen die der Reihe für diesen Termin
  const invitationCount = event.seriesId ? await prisma.invitation.count({ where: invitationsForEvent(event) }) : event._count.invitations
  return { user, event, isOwner: isOwnerOrAdmin(user, event.ownerId), invitationCount }
})

export type AdminEvent = NonNullable<Awaited<ReturnType<typeof loadAdminEvent>>>

/** Welche Reiter es für dieses Event gibt (nur Funktionen, die es nutzt). */
export function eventTabs({ event, isOwner, invitationCount }: AdminEvent) {
  const config = event.formConfig ? JSON.parse(event.formConfig) : {}
  const base = `/admin/events/${event.id}`
  return [
    { href: base, label: 'Übersicht', exact: true },
    { href: `${base}/gaeste`, label: `Gäste (${event._count.rsvps})` },
    ...(event.inviteOnly || invitationCount > 0 ? [{ href: `${base}/einladungen`, label: 'Einladungen' }] : []),
    ...(event._count.menuCourses > 0 || event.maxCompanions > 0 || config.askDiet || config.askAllergies || event.series?.askDiet || event.series?.askAllergies
      ? [{ href: `${base}/kueche`, label: 'Küche' }] : []),
    ...(event._count.ticketCategories > 0 ? [{ href: `${base}/zahlungen`, label: 'Zahlungen' }] : []),
    ...(event.wishlist || event._count.wishes > 0 ? [{ href: `${base}/wuensche`, label: 'Wünsche' }] : []),
    ...(event.trackPresence || event._count.presenceEntries > 0 ? [{ href: `${base}/anwesenheit`, label: 'Anwesenheit' }] : []),
    ...(isOwner ? [{ href: `${base}/nachrichten`, label: 'Nachrichten' }, { href: `${base}/einstellungen`, label: 'Einstellungen' }] : [])
  ]
}

/** Öffentliche Seite des Events (Einzel-Event oder Termin einer Reihe). */
export function guestPageOf(event: { slug: string; series: { slug: string } | null }): string {
  return event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`
}
