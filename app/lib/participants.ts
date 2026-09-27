// app/lib/participants.ts
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Löscht Participants, die keine einzige Rsvp mehr haben (samt ParticipantPushSubscription) -
 * die EINE Stelle dafür, damit Gastdaten (Name, Kontakt, Ernährung, Allergien, editToken,
 * Push-Abos) nicht als verwaiste Zeilen liegen bleiben.
 *
 * - Mit `candidateIds`: nur genau diese Participants (die des gerade gelöschten Termins bzw. der
 *   gerade gelöschten Antwort). Aufrufen, NACHDEM die Rsvps gelöscht sind - wer noch eine andere
 *   Antwort hat (z.B. zu einem weiteren Termin der Reihe), bleibt unangetastet.
 * - Ohne Argument: alle verwaisten Participants (täglicher Durchlauf in app/api/cron/cleanup).
 *
 * Die Bedingung "keine Rsvp" steht in beiden Löschabfragen selbst und beide laufen in einer
 * Transaktion - eine Antwort, die zwischen Nachschlagen und Löschen entsteht, rettet den
 * Participant also samt Push-Abo. Ein Participant eines Nutzer-Kontos (guestUserId) darf
 * mitgelöscht werden: Konto und Reihen-Mitgliedschaft bleiben, performRsvpSubmission legt den
 * Participant bei der nächsten Antwort aus dem zentralen Profil neu an.
 */
export async function deleteOrphanedParticipants(candidateIds?: (string | null | undefined)[]): Promise<number> {
  const ids = candidateIds ? [...new Set(candidateIds.filter((id): id is string => !!id))] : null
  if (ids && ids.length === 0) return 0

  const orphaned: Prisma.ParticipantWhereInput = { rsvps: { none: {} }, ...(ids ? { id: { in: ids } } : {}) }
  const [, deleted] = await prisma.$transaction([
    prisma.participantPushSubscription.deleteMany({ where: { participant: orphaned } }),
    prisma.participant.deleteMany({ where: orphaned })
  ])
  return deleted.count
}
