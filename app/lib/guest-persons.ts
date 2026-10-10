// app/lib/guest-persons.ts
import { prisma } from './prisma'
import { companionsOf, menuOf, type CompanionInput } from './persons'
import { menuForForm } from './menu-store'
import type { MenuCourseForForm, MenuSelection } from './menu'

/**
 * Begleitungen und Menü fürs Gästeformular (docs/KONZEPT-EINLADUNGEN.md): wie viele Begleitungen möglich sind,
 * die bisherigen der Antwort, die Gänge des Menüs und die eigene Wahl. Mit Ticketkategorien keine Begleitungen
 * (jede Person meldet sich selbst an). Hat die Verwaltung das Höchstmaß gesenkt, bleiben die bisherigen sichtbar
 * und änderbar - dieselbe Regel wie in performRsvpSubmission.
 */
export async function guestPersons(
  event: { id: string; maxCompanions: number },
  rsvp: { id: string } | null
): Promise<{ maxCompanions: number; companions: CompanionInput[]; menu: MenuCourseForForm[]; ownMenu: MenuSelection }> {
  const [categoryCount, persons, menu] = await Promise.all([
    prisma.ticketCategory.count({ where: { eventId: event.id } }),
    rsvp ? prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id }, include: { menuChoices: true }, orderBy: { position: 'asc' } }) : Promise.resolve([]),
    menuForForm(event.id)
  ])
  const companions = companionsOf(persons)
  return {
    maxCompanions: categoryCount > 0 ? 0 : Math.max(event.maxCompanions, companions.length),
    companions,
    menu,
    ownMenu: persons[0] ? menuOf(persons[0]) : {}
  }
}
