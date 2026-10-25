// app/admin/account-invite-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove } from '../lib/permissions'
import { inviteAccounts } from '../lib/guest-invites'

/**
 * Teilnehmendenkonten zu einem Termin einladen bzw. die Einladung zurücknehmen (app/lib/guest-invites.ts). Wer den
 * Termin mindestens moderiert. Welche Konten erlaubt sind, prüft inviteAccounts gegen die Auswahl des Kontos.
 */
export async function inviteAccountsToEvent(formData: FormData) {
  const user = await requireUser()
  const eventId = formData.get('eventId') as string
  const event = eventId ? await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } }) : null
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return
  const ids = formData.getAll('inviteGuestUser').filter((v): v is string => typeof v === 'string').slice(0, 1000)
  const count = await inviteAccounts(user, event, ids, formData.get('notifyInvites') === 'on')
  revalidatePath(`/admin/events/${event.id}`, 'layout')
  redirect(`/admin/events/${event.id}/gaeste?eingeladen=${count}#konten`)
}

export async function removeAccountInvite(formData: FormData) {
  const user = await requireUser()
  const inviteId = formData.get('inviteId') as string
  const invite = inviteId ? await prisma.guestUserEvent.findUnique({ where: { id: inviteId }, include: { event: true } }) : null
  if (!invite || !(await hasEventModeratorOrAbove(user, invite.event))) return
  await prisma.guestUserEvent.delete({ where: { id: invite.id } })
  revalidatePath(`/admin/events/${invite.eventId}`, 'layout')
  redirect(`/admin/events/${invite.eventId}/gaeste#konten`)
}
