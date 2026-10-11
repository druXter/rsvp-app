// app/lib/checkin.ts
//
// Einlass pro Person (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 6): Jede zusagende Person einer Antwort hat ihren
// eigenen Haken (RsvpPerson.checkedInAt). Beim Scannen kommen alle zusagenden Personen auf einmal herein, einzelne
// lassen sich danach aus- und wieder eintragen. Rsvp.hasAttended/checkedInAt bleiben die Zusammenfassung ("mindestens
// eine Person da", erster Zeitpunkt) - so zählen Antworten ohne Personenliste wie bisher.
import { prisma } from './prisma'

/** Checkt die Antwort und alle ihre zusagenden Personen ein, die noch nicht da sind. */
export async function checkInAll(rsvpId: string, now = new Date()) {
  await prisma.$transaction([
    prisma.rsvpPerson.updateMany({ where: { rsvpId, isAttending: true, checkedInAt: null }, data: { checkedInAt: now } }),
    prisma.rsvp.updateMany({ where: { id: rsvpId, hasAttended: false }, data: { hasAttended: true, checkedInAt: now } })
  ])
}

/** Trägt die Antwort und alle ihre Personen wieder aus. */
export async function checkOutAll(rsvpId: string) {
  await prisma.$transaction([
    prisma.rsvpPerson.updateMany({ where: { rsvpId }, data: { checkedInAt: null } }),
    prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: false, checkedInAt: null } })
  ])
}

/** Hakt eine einzelne zusagende Person an oder ab und gleicht die Antwort an. */
export async function togglePerson(personId: string, now = new Date()): Promise<void> {
  const person = await prisma.rsvpPerson.findUnique({ where: { id: personId }, select: { rsvpId: true, isAttending: true, checkedInAt: true } })
  if (!person || (!person.isAttending && !person.checkedInAt)) return
  await prisma.rsvpPerson.update({ where: { id: personId }, data: { checkedInAt: person.checkedInAt ? null : now } })
  await syncRsvpCheckin(person.rsvpId)
}

/**
 * Antwort an ihre Personen angleichen: da, sobald eine Person da ist; Zeitpunkt ist der früheste. Ohne
 * Personenliste bleibt die Antwort unverändert (dort gibt es nur den Haken der Antwort).
 */
export async function syncRsvpCheckin(rsvpId: string) {
  const persons = await prisma.rsvpPerson.findMany({ where: { rsvpId }, select: { checkedInAt: true } })
  if (persons.length === 0) return
  const times = persons.map(p => p.checkedInAt).filter((t): t is Date => t !== null).sort((a, b) => a.getTime() - b.getTime())
  await prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: times.length > 0, checkedInAt: times[0] ?? null } })
}
