// app/lib/account-participant.ts
import { prisma } from './prisma'

/**
 * Der Participant eines angemeldeten Teilnehmendenkontos für einen Termin: bei einer Reihe die reihenweite Identität
 * des Kontos, bei einem Einzel-Event die mit einer Antwort auf genau dieses Event. Wer angemeldet ist, antwortet immer
 * mit seinem Konto (performRsvpSubmission, außer im Einladungsmodus und mit persönlichem Link).
 *
 * Hat das Konto noch keinen, zählt eine frühere Antwort ohne Konto mit GENAU der Adresse des Kontos (Groß-/Klein-
 * schreibung egal): Sonst entstünde nach dem Anmelden eine zweite Antwort derselben Person. Ein angemeldetes Konto hat
 * seine Adresse bestätigt. Mit `adopt` (nur beim Antworten, nie beim Anzeigen) wird sie dem Konto zugeordnet.
 */
export async function findAccountParticipant(
  guestUser: { id: string; email: string }, event: { id: string; seriesId: string | null }, options: { adopt?: boolean } = {}
) {
  const scope = event.seriesId ? { seriesId: event.seriesId } : { seriesId: null, rsvps: { some: { eventId: event.id } } }
  const own = await prisma.participant.findFirst({ where: { ...scope, guestUserId: guestUser.id } })
  if (own) return own

  const email = guestUser.email.trim().toLowerCase()
  const anonymous = await prisma.participant.findMany({ where: { ...scope, guestUserId: null, email: { not: null } }, orderBy: { createdAt: 'asc' } })
  const match = anonymous.find(p => p.email!.trim().toLowerCase() === email)
  if (!match) return null
  if (!options.adopt) return match
  // Bedingung im WHERE: zwei gleichzeitige Antworten ordnen nur einmal zu
  const adopted = await prisma.participant.updateMany({ where: { id: match.id, guestUserId: null }, data: { guestUserId: guestUser.id } })
  return adopted.count === 1 ? { ...match, guestUserId: guestUser.id } : prisma.participant.findFirst({ where: { ...scope, guestUserId: guestUser.id } })
}
