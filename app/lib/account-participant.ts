// app/lib/account-participant.ts
import { randomUUID } from 'crypto'
import { prisma } from './prisma'

/**
 * Der Participant eines angemeldeten Teilnehmendenkontos für einen Termin: bei einer Reihe die reihenweite Identität
 * des Kontos, bei einem Einzel-Event die mit einer Antwort auf genau dieses Event. Wer angemeldet ist, antwortet immer
 * mit seinem Konto (performRsvpSubmission, außer im Einladungsmodus und mit persönlichem Link).
 *
 * Hat das Konto noch keinen, zählt eine frühere Antwort ohne Konto mit GENAU der Adresse des Kontos (Groß-/Klein-
 * schreibung egal) - aber nur, wenn diese Adresse dort bestätigt wurde. Sonst entstünde nach dem Anmelden eine zweite
 * Antwort derselben Person. Eine unbestätigte Adresse kann irgendwer eingetippt haben: Wer sie anlegt, behält ihren
 * persönlichen Link und läse nach der Übernahme das Profil des Kontos (docs/AUDIT-2026-11.md, R-01). Mit `adopt` (nur
 * beim Antworten, nie beim Anzeigen) wird sie dem Konto zugeordnet, bekommt einen neuen persönlichen Link und verliert
 * ihre Push-Abos - beides gehörte dem, der die Antwort angelegt hat.
 */
export async function findAccountParticipant(
  guestUser: { id: string; email: string }, event: { id: string; seriesId: string | null }, options: { adopt?: boolean } = {}
) {
  const scope = event.seriesId ? { seriesId: event.seriesId } : { seriesId: null, rsvps: { some: { eventId: event.id } } }
  const own = await prisma.participant.findFirst({ where: { ...scope, guestUserId: guestUser.id } })
  if (own) return own

  const email = guestUser.email.trim().toLowerCase()
  const anonymous = await prisma.participant.findMany({
    where: { ...scope, guestUserId: null, isVerified: true, email: { not: null } }, orderBy: { createdAt: 'asc' }
  })
  const match = anonymous.find(p => p.email!.trim().toLowerCase() === email)
  if (!match) return null
  if (!options.adopt) return match
  // Bedingung im WHERE: zwei gleichzeitige Antworten ordnen nur einmal zu
  const editToken = randomUUID()
  const adopted = await prisma.$transaction(async tx => {
    const updated = await tx.participant.updateMany({ where: { id: match.id, guestUserId: null, isVerified: true }, data: { guestUserId: guestUser.id, editToken } })
    if (updated.count === 1) await tx.participantPushSubscription.deleteMany({ where: { participantId: match.id } })
    return updated.count === 1
  })
  return adopted ? { ...match, guestUserId: guestUser.id, editToken } : prisma.participant.findFirst({ where: { ...scope, guestUserId: guestUser.id } })
}
