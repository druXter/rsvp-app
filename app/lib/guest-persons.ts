// app/lib/guest-persons.ts
import { prisma } from './prisma'
import { companionsOf, type CompanionInput } from './persons'

/**
 * Begleitungen fürs Gästeformular (docs/KONZEPT-EINLADUNGEN.md): wie viele möglich sind und die bisherigen der
 * Antwort. Mit Ticketkategorien keine (jede Person meldet sich selbst an). Hat die Verwaltung das Höchstmaß
 * gesenkt, bleiben die bisherigen sichtbar und änderbar - dieselbe Regel wie in performRsvpSubmission.
 */
export async function guestPersons(
  event: { id: string; maxCompanions: number },
  rsvp: { id: string } | null
): Promise<{ maxCompanions: number; companions: CompanionInput[] }> {
  const [categoryCount, persons] = await Promise.all([
    prisma.ticketCategory.count({ where: { eventId: event.id } }),
    rsvp ? prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id } }) : Promise.resolve([])
  ])
  const companions = companionsOf(persons)
  return { maxCompanions: categoryCount > 0 ? 0 : Math.max(event.maxCompanions, companions.length), companions }
}
