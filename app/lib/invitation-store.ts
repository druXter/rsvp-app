// app/lib/invitation-store.ts
//
// Datenbankseite der Einladungen (app/lib/invitations.ts, docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3).
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { asAgeGroup, menuOf } from './persons'
import { notifyLinkedToolsBeforeDelete, notifyLinkedToolsOfRsvps } from './linked-tools-notify'
import { fillFreeSeats } from './waitlist'
import { formatEventDate, isArchived } from './event-date'
import { formatDeadline } from './rsvp-deadline'
import { invitationCovers, type HouseholdPersonInput, type InvitationInput } from './invitations'

export { invitationCovers }

/** Wozu eine Einladung gehört: ein Einzel-Event oder eine Reihe (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3). */
export type InvitationScope = { eventId: string; seriesId?: undefined } | { seriesId: string; eventId?: undefined }

/** Termine einer Reihen-Einladung: alle (auch künftige) oder nur ausgewählte. */
export type InvitationEvents = { allEvents: true } | { allEvents: false; eventIds: string[] }

/**
 * Der persönliche Link eines Haushalts: bei Einzel-Events die Seite des Events, bei Reihen die Seite der Reihe (dort
 * stehen die Termine, zu denen der Haushalt eingeladen ist) bzw. direkt ein Termin (Erinnerung).
 */
export function invitationLink(target: { slug: string } | { seriesSlug: string; terminSlug?: string }, participant: { editToken: string }): string {
  const path = 'seriesSlug' in target ? `/reihe/${target.seriesSlug}${target.terminSlug ? `/${target.terminSlug}` : ''}` : `/${target.slug}`
  return `${baseUrl()}${path}?token=${participant.editToken}`
}

/** Link einer geladenen Einladung (mit event bzw. series). */
export function linkOfInvitation(invitation: { event?: { slug: string } | null; series?: { slug: string } | null; participant: { editToken: string } }): string {
  return invitation.series ? invitationLink({ seriesSlug: invitation.series.slug }, invitation.participant) : invitationLink(invitation.event!, invitation.participant)
}

/** Einladungen, die für diesen Termin gelten: die eigenen eines Einzel-Events bzw. die der Reihe, die ihn einschließen. */
export function invitationsForEvent(event: { id: string; seriesId: string | null }): Prisma.InvitationWhereInput {
  return event.seriesId
    ? { seriesId: event.seriesId, OR: [{ allEvents: true }, { events: { some: { eventId: event.id } } }] }
    : { eventId: event.id }
}

/** Legt Einladungen an - je eine mit eigenem Participant (editToken = Link) und den eingeladenen Personen. */
export async function createInvitations(scope: InvitationScope, inputs: readonly InvitationInput[], events: InvitationEvents = { allEvents: true }): Promise<number> {
  await prisma.$transaction(inputs.map(input => prisma.invitation.create({
    data: {
      ...(scope.seriesId
        ? {
            series: { connect: { id: scope.seriesId } },
            allEvents: events.allEvents,
            ...(events.allEvents ? {} : { events: { create: events.eventIds.map(eventId => ({ eventId })) } })
          }
        : { event: { connect: { id: scope.eventId! } } }),
      label: input.label,
      email: input.email,
      extraPersons: input.extraPersons,
      // Bei Reihen ein Participant der Reihe: derselbe Link gilt für alle Termine
      participant: { create: { name: input.label, email: input.email, editToken: randomUUID(), seriesId: scope.seriesId ?? null } },
      persons: { create: input.persons.map((p, position) => ({ name: p.name, ageGroup: p.ageGroup, position })) }
    }
  })))
  return inputs.length
}

/**
 * Ändert eine Einladung. Personen werden nach Position abgeglichen (eine umbenannte Person bleibt dieselbe, ihre
 * Antwort bleibt). Fallen Personen weg, fallen auch ihre Antworten weg - ebenso die Antworten zu Terminen, die bei
 * einer Reihen-Einladung abgewählt werden. Dann werden Plätze frei und verknüpfte Tools erfahren es.
 */
export async function updateInvitation(id: string, input: InvitationInput & { note: string | null; events?: InvitationEvents }): Promise<void> {
  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { id },
    include: { persons: { orderBy: { position: 'asc' } }, participant: { include: { rsvps: { select: { id: true, eventId: true } } } } }
  })
  const removed = invitation.persons.slice(input.persons.length).map(p => p.id)
  // Reihe: Antworten zu Terminen, zu denen der Haushalt nicht mehr eingeladen ist
  const events = invitation.seriesId ? input.events : undefined
  const droppedRsvps = events && !events.allEvents ? invitation.participant.rsvps.filter(r => !events.eventIds.includes(r.eventId)) : []
  if (droppedRsvps.length > 0) await notifyLinkedToolsBeforeDelete({ id: { in: droppedRsvps.map(r => r.id) } })
  await prisma.$transaction([
    prisma.invitation.update({ where: { id }, data: { label: input.label, email: input.email, extraPersons: input.extraPersons, note: input.note, ...(events ? { allEvents: events.allEvents } : {}) } }),
    ...(events ? [
      prisma.invitationEvent.deleteMany({ where: { invitationId: id } }),
      ...(events.allEvents ? [] : events.eventIds.map(eventId => prisma.invitationEvent.create({ data: { invitationId: id, eventId } })))
    ] : []),
    prisma.rsvp.deleteMany({ where: { id: { in: droppedRsvps.map(r => r.id) } } }),
    // Der Participant trägt die Bezeichnung als Namen (Verwaltung, Mails, Seating ohne zusagende Person)
    prisma.participant.update({ where: { id: invitation.participantId }, data: { name: input.label, ...(input.email ? { email: input.email } : {}) } }),
    ...input.persons.map((p, position) => invitation.persons[position]
      ? prisma.invitationPerson.update({ where: { id: invitation.persons[position].id }, data: { name: p.name, ageGroup: p.ageGroup } })
      : prisma.invitationPerson.create({ data: { invitationId: id, name: p.name, ageGroup: p.ageGroup, position } })),
    prisma.rsvpPerson.deleteMany({ where: { invitationPersonId: { in: removed } } }),
    prisma.invitationPerson.deleteMany({ where: { id: { in: removed } } })
  ])
  // Altersgruppe aus der Einladung gilt auch für die Antwort
  for (const [position, p] of input.persons.entries()) {
    const current = invitation.persons[position]
    if (current) await prisma.rsvpPerson.updateMany({ where: { invitationPersonId: current.id }, data: { ageGroup: p.ageGroup } })
  }
  const remaining = invitation.participant.rsvps.filter(r => !droppedRsvps.includes(r))
  if (remaining.length > 0) {
    // Eine Antwort ohne zusagende Person ist eine Absage
    for (const { id: rsvpId } of remaining) {
      const attending = await prisma.rsvpPerson.count({ where: { rsvpId, isAttending: true, ageGroup: { not: 'INFANT' } } })
      if (attending === 0) await prisma.rsvp.updateMany({ where: { id: rsvpId, isAttending: true }, data: { isAttending: false, isOnWaitlist: false } })
    }
    notifyLinkedToolsOfRsvps(remaining.map(r => r.id))
  }
  for (const eventId of new Set(invitation.participant.rsvps.map(r => r.eventId))) await fillFreeSeats(eventId)
}

/** Löscht eine Einladung samt Antworten und Participant. Plätze werden frei, verknüpfte Tools erfahren es. */
export async function deleteInvitation(id: string): Promise<void> {
  const invitation = await prisma.invitation.findUnique({ where: { id }, include: { participant: { include: { rsvps: true } } } })
  if (!invitation) return
  const freed = new Set(invitation.participant.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).map(r => r.eventId))
  await notifyLinkedToolsBeforeDelete({ participantId: invitation.participantId })
  await prisma.$transaction([
    prisma.rsvp.deleteMany({ where: { participantId: invitation.participantId } }),
    prisma.participantPushSubscription.deleteMany({ where: { participantId: invitation.participantId } }),
    prisma.participant.delete({ where: { id: invitation.participantId } })
  ])
  for (const eventId of freed) await fillFreeSeats(eventId)
}

/** Einladung eines Participants zu genau diesem Termin (eigene oder über die Reihe), oder null. */
export async function invitationOf(participantId: string | null | undefined, event: { id: string; seriesId: string | null }) {
  if (!participantId) return null
  const invitation = await prisma.invitation.findUnique({ where: { participantId }, include: { persons: { orderBy: { position: 'asc' } }, events: { select: { eventId: true } } } })
  return invitation && invitationCovers(invitation, event) ? invitation : null
}

/** Wozu eingeladen wird - für Einladungs- und Erinnerungsmails: Titel und je Termin eine Zeile (Wann, Wo, Frist). */
export type InvitationOccasion = { title: string; dates: string[] }

function dateLine(event: { title: string; date: Date; datePending: boolean; location: string | null; rsvpDeadline: Date | null }, withTitle: boolean): string {
  const deadline = formatDeadline(event.rsvpDeadline)
  return `${withTitle ? `${event.title}: ` : ''}${formatEventDate(event)}${event.location ? `, ${event.location}` : ''}${deadline ? ` (bitte antwortet bis ${deadline})` : ''}`
}

/** Ein Termin (Einzel-Event oder - für die Erinnerung - ein Reihen-Termin mit dem Titel der Reihe davor). */
export function occasionOfEvent(event: Parameters<typeof dateLine>[0], seriesTitle?: string | null): InvitationOccasion {
  return { title: seriesTitle ? `${seriesTitle}: ${event.title}` : event.title, dates: [dateLine(event, false)] }
}

/** Einladung zu einem Einzel-Event bzw. zu den (noch nicht archivierten) Terminen einer Reihe, zu denen sie gilt. */
export async function invitationOccasion(invitation: {
  event: Parameters<typeof dateLine>[0] | null; seriesId: string | null; series: { title: string } | null; eventId: string | null; allEvents: boolean; events: { eventId: string }[]
}, now = new Date()): Promise<InvitationOccasion> {
  if (!invitation.seriesId || !invitation.series) return occasionOfEvent(invitation.event!)
  const termine = await prisma.event.findMany({ where: { seriesId: invitation.seriesId }, orderBy: { date: 'asc' } })
  const covered = termine.filter(t => invitationCovers(invitation, t) && !isArchived(t, now))
  return { title: invitation.series.title, dates: covered.map(t => dateLine(t, true)) }
}

export type HouseholdRow = HouseholdPersonInput & { answered: boolean }

/**
 * Die Personen fürs Formular eines Haushalts: eingeladene in ihrer Reihenfolge, mit der bisherigen Antwort
 * (answered = schon beantwortet), danach selbst eingetragene Zusatzpersonen.
 */
export async function householdForForm(invitation: { id: string; persons: { id: string; name: string; ageGroup: string; position: number }[] }, rsvpId: string | null): Promise<HouseholdRow[]> {
  const answers = rsvpId
    ? await prisma.rsvpPerson.findMany({ where: { rsvpId }, include: { menuChoices: true }, orderBy: { position: 'asc' } })
    : []
  const invited = invitation.persons.map(p => {
    const answer = answers.find(a => a.invitationPersonId === p.id)
    return {
      invitationPersonId: p.id,
      name: answer?.name || p.name,
      ageGroup: asAgeGroup(p.ageGroup),
      isAttending: answer?.isAttending ?? false,
      dietaryOption: answer?.dietaryOption ?? null,
      allergies: answer?.allergies ?? null,
      menu: answer ? menuOf(answer) : {},
      drinksAlcohol: answer?.drinksAlcohol ?? null,
      answered: !!answer
    }
  })
  const extras = answers.filter(a => !a.invitationPersonId).map(a => ({
    invitationPersonId: null,
    name: a.name ?? '',
    ageGroup: asAgeGroup(a.ageGroup),
    isAttending: a.isAttending,
    dietaryOption: a.dietaryOption,
    allergies: a.allergies,
    menu: menuOf(a),
    drinksAlcohol: a.drinksAlcohol,
    answered: true
  }))
  return [...invited, ...extras]
}
