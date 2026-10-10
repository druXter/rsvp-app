// app/admin/einladungen/[eventId]/druck/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'qrcode'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../../lib/permissions'
import { formatPersonList } from '../../../../lib/invitations'
import { invitationLink } from '../../../../lib/invitation-store'
import { formatDeadline } from '../../../../lib/rsvp-deadline'
import PrintButton from '../../../kueche/[eventId]/print-button'

/**
 * Druckliste der Einladungen (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): pro Haushalt eine Karte mit Personen,
 * persönlichem Link und QR-Code - zum Ausschneiden oder als Vorlage für gedruckte Einladungskarten.
 */
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
  const cards = await Promise.all(invitations.map(async invitation => {
    const link = invitationLink(event, invitation.participant)
    return { invitation, link, qr: await QRCode.toDataURL(link, { width: 240, margin: 1 }) }
  }))
  const deadline = formatDeadline(event.rsvpDeadline)

  return (
    <main className="min-h-screen bg-white text-gray-900 p-6 print:p-0">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <h1 className="text-xl font-bold">Druckliste: {event.title}</h1>
        <div className="flex gap-4 items-center">
          <PrintButton />
          <Link href={`/admin/einladungen/${event.id}`} className="text-sm text-gray-600 hover:underline">Zurück zu den Einladungen</Link>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2">
        {cards.map(({ invitation, link, qr }) => (
          <section key={invitation.id} className="border border-gray-300 rounded p-4 flex gap-4 break-inside-avoid" data-testid="invitation-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR-Code für ${invitation.label}`} className="w-28 h-28 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="font-bold text-base">{invitation.label}</p>
              <p>{formatPersonList(invitation.persons)}{invitation.extraPersons > 0 ? ` (+${invitation.extraPersons})` : ''}</p>
              {deadline && <p className="mt-1">Bitte antwortet bis {deadline}.</p>}
              <p className="mt-1 font-mono text-[10px] break-all text-gray-600">{link}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
