// app/admin/einladungen/reihe/[seriesId]/druck/page.tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../../../lib/prisma'
import { getCurrentUser } from '../../../../../lib/auth'
import { hasSeriesModeratorOrAbove } from '../../../../../lib/permissions'
import { invitationCovers, invitationLink } from '../../../../../lib/invitation-store'
import { isArchived } from '../../../../../lib/event-date'
import InvitationPrintSheet from '../../../print-sheet'

/**
 * Druckliste der Einladungen einer Reihe (Karten: app/admin/einladungen/print-sheet.tsx) - ein QR-Code pro Haushalt
 * für alle Termine, zu denen er eingeladen ist; die Termine stehen auf der Karte.
 */
export default async function SeriesInvitationPrintPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const { seriesId } = await params
  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId }, include: { events: { orderBy: { date: 'asc' } } } })
  if (!series || !(await hasSeriesModeratorOrAbove(user, series))) return notFound()

  const invitations = await prisma.invitation.findMany({
    where: { seriesId },
    include: { participant: true, persons: { orderBy: { position: 'asc' } }, events: { select: { eventId: true } } },
    orderBy: { createdAt: 'asc' }
  })
  const current = series.events.filter(e => !isArchived(e))
  return (
    <InvitationPrintSheet
      title={series.title}
      backHref={`/admin/series/${series.id}/einladungen`}
      items={invitations.map(invitation => ({
        invitation,
        link: invitationLink({ seriesSlug: series.slug }, invitation.participant),
        hint: `Eingeladen zu: ${current.filter(e => invitationCovers(invitation, e)).map(e => e.title).join(', ') || '–'}`
      }))}
    />
  )
}
