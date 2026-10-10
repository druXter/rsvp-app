// app/admin/invitation-actions.ts
'use server'

// Einladungen pro Haushalt verwalten (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3). Anlegen, Ändern und Löschen dürfen
// alle mit Zugriff auf die Gästeliste (Owner, Admin, Moderator*innen), Mails verschicken nur Owner und Admins (wie
// Erinnerungen). Einladungen gibt es nur für Einzel-Events.
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove, isOwnerOrAdmin } from '../lib/permissions'
import { formString } from '../lib/form'
import { INVITATION_LIMITS, parseInvitationLines, parsePersonList } from '../lib/invitations'
import { createInvitations, deleteInvitation, invitationLink, updateInvitation } from '../lib/invitation-store'
import { sendInvitationEmail } from '../lib/mail'
import { formatDeadline } from '../lib/rsvp-deadline'
import { sendInvitationRemindersForEvent } from '../lib/invitation-reminder'

export type InvitationFormState = { error?: string; added?: number; saved?: boolean } | null

async function editableEvent(eventId: string) {
  const user = await requireUser()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.seriesId || !(await hasEventModeratorOrAbove(user, event))) return null
  return { user, event }
}

/** Neue Einladungen aus dem Textfeld (eine Zeile pro Haushalt). Fehler kommen als Meldung zurück, nichts halb gespeichert. */
export async function addInvitations(_prev: InvitationFormState, formData: FormData): Promise<InvitationFormState> {
  const access = await editableEvent(formString(formData, 'eventId', 50))
  if (!access) return { error: 'Termin nicht gefunden.' }
  let inputs
  try {
    inputs = parseInvitationLines(formString(formData, 'invitations', 100_000))
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Eingabe.' }
  }
  if (inputs.length === 0) return { error: 'Bitte mindestens eine Zeile eintragen.' }
  const existing = await prisma.invitation.count({ where: { eventId: access.event.id } })
  if (existing + inputs.length > INVITATION_LIMITS.invitations) return { error: `Höchstens ${INVITATION_LIMITS.invitations} Einladungen pro Termin.` }
  await createInvitations(access.event.id, inputs)
  revalidatePath(`/admin/events/${access.event.id}/einladungen`)
  return { added: inputs.length }
}

/** Eine Einladung ändern (Bezeichnung, E-Mail, Personen, Zusatzpersonen, Notiz). Der Link bleibt gleich. */
export async function saveInvitation(_prev: InvitationFormState, formData: FormData): Promise<InvitationFormState> {
  const invitation = await prisma.invitation.findUnique({ where: { id: formString(formData, 'invitationId', 50) } })
  const access = invitation ? await editableEvent(invitation.eventId) : null
  if (!invitation || !access) return { error: 'Einladung nicht gefunden.' }
  const label = formString(formData, 'label', INVITATION_LIMITS.label + 1)
  const email = formString(formData, 'email', 255).toLowerCase() || null
  const extra = Number(formString(formData, 'extraPersons', 5) || '0')
  try {
    if (!label) throw new Error('Bitte eine Bezeichnung eintragen.')
    if (label.length > INVITATION_LIMITS.label) throw new Error('Die Bezeichnung ist zu lang.')
    if (email && !/^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(email)) throw new Error(`„${email}“ ist keine gültige E-Mail-Adresse.`)
    if (!Number.isInteger(extra) || extra < 0 || extra > INVITATION_LIMITS.extraPersons) throw new Error(`Zusatzpersonen: 0 bis ${INVITATION_LIMITS.extraPersons}.`)
    const persons = parsePersonList(formString(formData, 'persons', 5000))
    if (persons.length === 0) throw new Error('Bitte mindestens eine Person eintragen.')
    await updateInvitation(invitation.id, { label, email, persons, extraPersons: extra, note: formString(formData, 'note', INVITATION_LIMITS.note) || null })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Eingabe.' }
  }
  revalidatePath(`/admin/events/${invitation.eventId}/einladungen`)
  revalidatePath('/admin', 'layout')
  return { saved: true }
}

/** Einladung samt Antwort löschen. */
export async function removeInvitation(formData: FormData) {
  const invitation = await prisma.invitation.findUnique({ where: { id: formString(formData, 'invitationId', 50) } })
  if (!invitation || !(await editableEvent(invitation.eventId))) return
  await deleteInvitation(invitation.id)
  revalidatePath(`/admin/events/${invitation.eventId}/einladungen`)
  revalidatePath('/admin', 'layout')
}

/**
 * Einladungsmails: ohne invitationId an alle Haushalte mit E-Mail, die noch keine bekommen haben, mit
 * invitationId genau diese eine (erneut). Nur Owner und Admins. Ein Versandfehler bricht nicht ab, der Haushalt
 * bleibt dann als "nicht gesendet" stehen.
 */
export async function sendInvitations(formData: FormData) {
  const eventId = formString(formData, 'eventId', 50)
  const invitationId = formString(formData, 'invitationId', 50) || null
  const user = await requireUser()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.seriesId || !isOwnerOrAdmin(user, event.ownerId)) return
  const invitations = await prisma.invitation.findMany({
    where: { eventId, email: { not: null }, ...(invitationId ? { id: invitationId } : { sentAt: null }) },
    include: { participant: true, persons: { orderBy: { position: 'asc' } } }
  })
  let sent = 0
  for (const invitation of invitations) {
    // Erst als gesendet markieren (atomar), dann senden: ein Doppelklick verschickt nichts doppelt
    if (!invitationId) {
      const claimed = await prisma.invitation.updateMany({ where: { id: invitation.id, sentAt: null }, data: { sentAt: new Date() } })
      if (claimed.count !== 1) continue
    }
    try {
      await sendInvitationEmail({ ...invitation, email: invitation.email! }, event, invitationLink(event, invitation.participant), { deadline: formatDeadline(event.rsvpDeadline) })
      if (invitationId) await prisma.invitation.update({ where: { id: invitation.id }, data: { sentAt: new Date() } })
      sent++
    } catch (error) {
      console.error('Fehler beim Versand der Einladung:', error)
      if (!invitationId) await prisma.invitation.update({ where: { id: invitation.id }, data: { sentAt: null } })
    }
  }
  revalidatePath(`/admin/events/${eventId}/einladungen`)
  redirect(`/admin/events/${eventId}/einladungen?gesendet=${sent}`)
}

/** Erinnerung an alle Haushalte ohne Antwort (mit E-Mail). Nur Owner und Admins. */
export async function remindInvitations(formData: FormData) {
  const eventId = formString(formData, 'eventId', 50)
  const user = await requireUser()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.seriesId || !isOwnerOrAdmin(user, event.ownerId)) return
  const sent = await sendInvitationRemindersForEvent(eventId)
  revalidatePath(`/admin/events/${eventId}/einladungen`)
  redirect(`/admin/events/${eventId}/einladungen?erinnert=${sent}`)
}
