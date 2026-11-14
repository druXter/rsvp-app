// app/lib/edit-link.ts
import type { Participant } from '@prisma/client'
import { prisma } from './prisma'
import { invitationOf } from './invitation-store'

/**
 * Der Participant hinter einem persönlichen Link (`editToken`) - aber nur, wenn der Link zu GENAU diesem Termin
 * gehört, sonst null. Ein fremder Link (anderer Termin, andere Reihe) zählt wie keiner: Er ist nicht unbedingt
 * falsch, aber mit ihm bearbeitet man hier nichts - sonst hinge eine Antwort an einem Participant, der zu einem ganz
 * anderen Termin gehört, und dessen `seriesId` würde umgeschrieben (docs/AUDIT-2026-11.md, „Persönlicher Link eines
 * anderen Termins“).
 *
 * - Einladungsmodus: nur der Haushalt einer Einladung, die diesen Termin abdeckt (`invitationOf`).
 * - Reihen-Termin: der Participant dieser Reihe - auch für einen Termin, den er noch nicht beantwortet hat.
 * - Einzel-Event: nur mit einer Antwort auf genau dieses Event.
 *
 * Seiten und `performRsvpSubmission` lösen den Link hierüber auf, `submitRsvp` ebenso (Bot-Schutz, Konto).
 */
export async function participantForLink(
  token: string | null | undefined,
  event: { id: string; seriesId: string | null; inviteOnly: boolean }
): Promise<Participant | null> {
  if (!token) return null
  const participant = await prisma.participant.findUnique({ where: { editToken: token } })
  if (!participant) return null
  if (event.inviteOnly) return (await invitationOf(participant.id, event)) ? participant : null
  if (event.seriesId) return participant.seriesId === event.seriesId ? participant : null
  const rsvp = await prisma.rsvp.findUnique({
    where: { eventId_participantId: { eventId: event.id, participantId: participant.id } },
    select: { id: true }
  })
  return rsvp ? participant : null
}
