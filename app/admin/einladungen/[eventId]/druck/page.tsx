// app/admin/einladungen/[eventId]/druck/page.tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../../lib/permissions'
import { invitationLink } from '../../../../lib/invitation-store'
import { formatDeadline } from '../../../../lib/rsvp-deadline'
import InvitationPrintSheet from '../../print-sheet'

/** Druckliste der Einladungen eines Einzel-Events (Karten: app/admin/einladungen/print-sheet.tsx). */
export default async function InvitationPrintPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const { eventId } = await params
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.seriesId || !(await hasEventModeratorOrAbove(user, event))) return notFound()

  const invitations = await prisma.invitation.findMany({
    where: { eventId },
    include: { participant: true, persons: { orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'asc' }
  })
  const deadline = formatDeadline(event.rsvpDeadline)
  return (
    <InvitationPrintSheet
      title={event.title}
      backHref={`/admin/events/${event.id}/einladungen`}
      items={invitations.map(invitation => ({ invitation, link: invitationLink(event, invitation.participant), hint: deadline ? `Bitte antwortet bis ${deadline}.` : null }))}
    />
  )
}
