// app/admin/invitation-actions.ts
'use server'

// Einladungen pro Haushalt verwalten (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3) - für Einzel-Events (eventId) und
// Reihen (seriesId, ein Link pro Haushalt für alle bzw. ausgewählte Termine). Anlegen, Ändern und Löschen dürfen
// alle mit Zugriff auf die Gästeliste (Owner, Admin, Moderator*innen), Mails verschicken nur Owner und Admins (wie
// Erinnerungen).
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove, hasSeriesModeratorOrAbove, isOwnerOrAdmin } from '../lib/permissions'
import { formString } from '../lib/form'
import { INVITATION_LIMITS, parseInvitationLines, parsePersonList } from '../lib/invitations'
import { createInvitations, deleteInvitation, invitationOccasion, linkOfInvitation, updateInvitation, type InvitationEvents, type InvitationScope } from '../lib/invitation-store'
import { sendInvitationEmail } from '../lib/mail'
import { sendInvitationRemindersForEvent } from '../lib/invitation-reminder'

export type InvitationFormState = { error?: string; added?: number; saved?: boolean } | null

type Access = { scope: InvitationScope; path: string; userCanSend: boolean; termine: { id: string }[] }

/**
 * Wozu verwaltet wird: ein Einzel-Event (eventId) oder eine Reihe (seriesId) - nur mit Zugriff auf die Gästeliste.
 * Reihen-Termine haben keine eigenen Einladungen, die hängen an der Reihe.
 */
async function access(ids: { eventId?: string | null; seriesId?: string | null }): Promise<Access | null> {
  const user = await requireUser()
  if (ids.seriesId) {
    const series = await prisma.eventSeries.findUnique({ where: { id: ids.seriesId }, include: { events: { select: { id: true } } } })
    if (!series || !(await hasSeriesModeratorOrAbove(user, series))) return null
    return { scope: { seriesId: series.id }, path: `/admin/series/${series.id}/einladungen`, userCanSend: isOwnerOrAdmin(user, series.ownerId), termine: series.events }
  }
  if (!ids.eventId) return null
  const event = await prisma.event.findUnique({ where: { id: ids.eventId } })
  if (!event || event.seriesId || !(await hasEventModeratorOrAbove(user, event))) return null
  return { scope: { eventId: event.id }, path: `/admin/events/${event.id}/einladungen`, userCanSend: isOwnerOrAdmin(user, event.ownerId), termine: [] }
}

function accessOfForm(formData: FormData) {
  return access({ eventId: formString(formData, 'eventId', 50) || null, seriesId: formString(formData, 'seriesId', 50) || null })
}

function accessOfInvitation(invitation: { eventId: string | null; seriesId: string | null }) {
  return access({ eventId: invitation.eventId, seriesId: invitation.seriesId })
}

/**
 * Termine einer Reihen-Einladung aus dem Formular (Markierungsfeld allEventsShown): allEvents=1 für alle (auch
 * künftige), sonst die angekreuzten (invitationEvent), nur Termine dieser Reihe. Sonst undefined = unverändert.
 */
function readInvitationEvents(formData: FormData, target: Access): InvitationEvents | undefined {
  if (!target.scope.seriesId || !formData.has('allEventsShown')) return undefined
  if (formData.get('allEvents') !== '0') return { allEvents: true }
  const own = new Set(target.termine.map(t => t.id))
  const eventIds = [...new Set(formData.getAll('invitationEvent').map(String))].filter(id => own.has(id))
  if (eventIds.length === 0) throw new Error('Bitte mindestens einen Termin auswählen (oder „alle Termine“).')
  return { allEvents: false, eventIds }
}

/** Neue Einladungen aus dem Textfeld (eine Zeile pro Haushalt). Fehler kommen als Meldung zurück, nichts halb gespeichert. */
export async function addInvitations(_prev: InvitationFormState, formData: FormData): Promise<InvitationFormState> {
  const target = await accessOfForm(formData)
  if (!target) return { error: 'Termin nicht gefunden.' }
  let inputs
  let events
  try {
    inputs = parseInvitationLines(formString(formData, 'invitations', 100_000))
    events = readInvitationEvents(formData, target)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Eingabe.' }
  }
  if (inputs.length === 0) return { error: 'Bitte mindestens eine Zeile eintragen.' }
  const existing = await prisma.invitation.count({ where: target.scope })
  if (existing + inputs.length > INVITATION_LIMITS.invitations) return { error: `Höchstens ${INVITATION_LIMITS.invitations} Einladungen pro ${target.scope.seriesId ? 'Reihe' : 'Termin'}.` }
  await createInvitations(target.scope, inputs, events)
  revalidatePath(target.path)
  revalidatePath('/admin', 'layout')
  return { added: inputs.length }
}

/** Eine Einladung ändern (Bezeichnung, E-Mail, Personen, Zusatzpersonen, Notiz, bei Reihen die Termine). Der Link bleibt gleich. */
export async function saveInvitation(_prev: InvitationFormState, formData: FormData): Promise<InvitationFormState> {
  const invitation = await prisma.invitation.findUnique({ where: { id: formString(formData, 'invitationId', 50) } })
  const target = invitation ? await accessOfInvitation(invitation) : null
  if (!invitation || !target) return { error: 'Einladung nicht gefunden.' }
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
    const events = readInvitationEvents(formData, target)
    await updateInvitation(invitation.id, { label, email, persons, extraPersons: extra, note: formString(formData, 'note', INVITATION_LIMITS.note) || null, events })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Eingabe.' }
  }
  revalidatePath(target.path)
  revalidatePath('/admin', 'layout')
  return { saved: true }
}

/** Einladung samt Antworten löschen. */
export async function removeInvitation(formData: FormData) {
  const invitation = await prisma.invitation.findUnique({ where: { id: formString(formData, 'invitationId', 50) } })
  const target = invitation ? await accessOfInvitation(invitation) : null
  if (!invitation || !target) return
  await deleteInvitation(invitation.id)
  revalidatePath(target.path)
  revalidatePath('/admin', 'layout')
}

/**
 * Einladungsmails: ohne invitationId an alle Haushalte mit E-Mail, die noch keine bekommen haben, mit
 * invitationId genau diese eine (erneut). Nur Owner und Admins. Ein Versandfehler bricht nicht ab, der Haushalt
 * bleibt dann als "nicht gesendet" stehen.
 */
export async function sendInvitations(formData: FormData) {
  const target = await accessOfForm(formData)
  if (!target || !target.userCanSend) return
  const invitationId = formString(formData, 'invitationId', 50) || null
  const invitations = await prisma.invitation.findMany({
    where: { ...target.scope, email: { not: null }, ...(invitationId ? { id: invitationId } : { sentAt: null }) },
    include: { participant: true, persons: { orderBy: { position: 'asc' } }, event: true, series: true, events: { select: { eventId: true } } }
  })
  let sent = 0
  for (const invitation of invitations) {
    // Erst als gesendet markieren (atomar), dann senden: ein Doppelklick verschickt nichts doppelt
    if (!invitationId) {
      const claimed = await prisma.invitation.updateMany({ where: { id: invitation.id, sentAt: null }, data: { sentAt: new Date() } })
      if (claimed.count !== 1) continue
    }
    try {
      await sendInvitationEmail({ ...invitation, email: invitation.email! }, await invitationOccasion(invitation), linkOfInvitation(invitation))
      if (invitationId) await prisma.invitation.update({ where: { id: invitation.id }, data: { sentAt: new Date() } })
      sent++
    } catch (error) {
      console.error('Fehler beim Versand der Einladung:', error)
      if (!invitationId) await prisma.invitation.update({ where: { id: invitation.id }, data: { sentAt: null } })
    }
  }
  revalidatePath(target.path)
  redirect(`${target.path}?gesendet=${sent}`)
}

/**
 * Erinnerung an alle Haushalte ohne Antwort zu diesem Termin (mit E-Mail). Nur Owner und Admins; bei Reihen pro
 * Termin, vom Einladungs-Reiter des Termins aus.
 */
export async function remindInvitations(formData: FormData) {
  const eventId = formString(formData, 'eventId', 50)
  const user = await requireUser()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || (event.seriesId && !event.inviteOnly) || !isOwnerOrAdmin(user, event.ownerId)) return
  const sent = await sendInvitationRemindersForEvent(eventId)
  revalidatePath(`/admin/events/${eventId}/einladungen`)
  redirect(`/admin/events/${eventId}/einladungen?erinnert=${sent}`)
}
