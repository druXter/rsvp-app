// app/lib/checkin.ts
//
// Einlass pro Person (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 6): Jede zusagende Person einer Antwort hat ihren
// eigenen Haken (RsvpPerson.checkedInAt). Beim Scannen kommen alle zusagenden Personen auf einmal herein, einzelne
// lassen sich danach aus- und wieder eintragen. Rsvp.hasAttended/checkedInAt bleiben die Zusammenfassung ("mindestens
// eine Person da", erster Zeitpunkt) - so zählen Antworten ohne Personenliste wie bisher.
//
// Kommen und Gehen (Idee L7, Event.trackPresence): Auschecken heißt dann "geht" - checkedInAt und hasAttended bleiben,
// leftAt hält fest, seit wann die Person weg ist, und wer wiederkommt, ist wieder da (leftAt null). Jeder Wechsel
// landet in PresenceEntry. Ohne die Option ist Auschecken wie bisher eine Korrektur ("war nicht da").
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export type PresenceKind = 'IN' | 'OUT'

/** Gerade da: eingecheckt und (mit Kommen und Gehen) nicht gegangen. Personen über checkedInAt, Antworten über hasAttended. */
export function isPresent(row: { hasAttended?: boolean; checkedInAt?: Date | null; leftAt?: Date | null }, isPerson = false): boolean {
  return (isPerson ? !!row.checkedInAt : !!row.hasAttended) && !row.leftAt
}

type PresenceRsvp = NonNullable<Awaited<ReturnType<typeof loadPresenceRsvp>>>

function loadPresenceRsvp(rsvpId: string) {
  return prisma.rsvp.findUnique({
    where: { id: rsvpId },
    include: { event: { select: { trackPresence: true } }, participant: { select: { name: true } }, persons: { orderBy: { position: 'asc' } } }
  })
}

/** Name fürs Protokoll: Person der Antwort bzw. die anmeldende Person. */
function nameAt(rsvp: PresenceRsvp, position: number | null): string {
  if (position === null) return rsvp.participant.name
  const person = rsvp.persons.find(p => p.position === position)
  return person?.name || (position === 0 ? rsvp.participant.name : 'Begleitung')
}

function entry(rsvp: PresenceRsvp, position: number | null, kind: PresenceKind, at: Date) {
  return prisma.presenceEntry.create({ data: { eventId: rsvp.eventId, rsvpId: rsvp.id, position, name: nameAt(rsvp, position), kind, at } })
}

/** Checkt die Antwort und alle ihre zusagenden Personen ein, die noch nicht da sind (mit Kommen und Gehen: auch Gegangene). */
export async function checkInAll(rsvpId: string, now = new Date()) {
  const rsvp = await loadPresenceRsvp(rsvpId)
  if (!rsvp) return
  if (!rsvp.event.trackPresence) {
    await prisma.$transaction([
      prisma.rsvpPerson.updateMany({ where: { rsvpId, isAttending: true, checkedInAt: null }, data: { checkedInAt: now } }),
      prisma.rsvp.updateMany({ where: { id: rsvpId, hasAttended: false }, data: { hasAttended: true, checkedInAt: now } })
    ])
    return
  }
  if (rsvp.persons.length === 0) {
    if (isPresent(rsvp)) return
    await prisma.$transaction([
      prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: true, checkedInAt: rsvp.checkedInAt ?? now, leftAt: null } }),
      entry(rsvp, null, 'IN', now)
    ])
    return
  }
  const arriving = rsvp.persons.filter(p => p.isAttending && !isPresent(p, true))
  if (arriving.length === 0) return
  await prisma.$transaction([
    ...arriving.map(p => prisma.rsvpPerson.update({ where: { id: p.id }, data: { checkedInAt: p.checkedInAt ?? now, leftAt: null } })),
    ...arriving.map(p => entry(rsvp, p.position, 'IN', now))
  ])
  await syncRsvpCheckin(rsvpId)
}

/** Trägt die Antwort und alle ihre Personen wieder aus - Korrektur, kein Gehen (auch beim Stornieren). */
export async function checkOutAll(rsvpId: string) {
  await prisma.$transaction([
    prisma.rsvpPerson.updateMany({ where: { rsvpId }, data: { checkedInAt: null, leftAt: null } }),
    prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: false, checkedInAt: null, leftAt: null } })
  ])
}

/** Kommen und Gehen: Alle anwesenden Personen der Antwort gehen (Protokoll), bleiben aber "da gewesen". */
export async function leaveAll(rsvpId: string, now = new Date()) {
  const rsvp = await loadPresenceRsvp(rsvpId)
  if (!rsvp?.event.trackPresence) return
  if (rsvp.persons.length === 0) {
    if (!isPresent(rsvp)) return
    await prisma.$transaction([prisma.rsvp.update({ where: { id: rsvpId }, data: { leftAt: now } }), entry(rsvp, null, 'OUT', now)])
    return
  }
  const leaving = rsvp.persons.filter(p => isPresent(p, true))
  if (leaving.length === 0) return
  await prisma.$transaction([
    ...leaving.map(p => prisma.rsvpPerson.update({ where: { id: p.id }, data: { leftAt: now } })),
    ...leaving.map(p => entry(rsvp, p.position, 'OUT', now))
  ])
  await syncRsvpCheckin(rsvpId)
}

/**
 * Ein-/Auschecken der ganzen Antwort (Gästeliste, Check-in-Seite): Wer da ist, geht (mit Kommen und Gehen) bzw. wird
 * ausgetragen (ohne); sonst kommen alle herein.
 */
export async function toggleAll(rsvpId: string, now = new Date()) {
  const rsvp = await prisma.rsvp.findUnique({ where: { id: rsvpId }, select: { hasAttended: true, leftAt: true, event: { select: { trackPresence: true } } } })
  if (!rsvp) return
  if (rsvp.event.trackPresence) await (isPresent(rsvp) ? leaveAll(rsvpId, now) : checkInAll(rsvpId, now))
  else await (rsvp.hasAttended ? checkOutAll(rsvpId) : checkInAll(rsvpId, now))
}

/** Hakt eine einzelne zusagende Person an oder ab (mit Kommen und Gehen: geht bzw. kommt wieder) und gleicht die Antwort an. */
export async function togglePerson(personId: string, now = new Date()): Promise<void> {
  const person = await prisma.rsvpPerson.findUnique({ where: { id: personId }, select: { rsvpId: true, position: true, isAttending: true, checkedInAt: true, leftAt: true } })
  if (!person || (!person.isAttending && !person.checkedInAt)) return
  const rsvp = await loadPresenceRsvp(person.rsvpId)
  if (!rsvp) return
  if (!rsvp.event.trackPresence) {
    await prisma.rsvpPerson.update({ where: { id: personId }, data: { checkedInAt: person.checkedInAt ? null : now, leftAt: null } })
  } else if (isPresent(person, true)) {
    await prisma.$transaction([prisma.rsvpPerson.update({ where: { id: personId }, data: { leftAt: now } }), entry(rsvp, person.position, 'OUT', now)])
  } else {
    if (!person.isAttending) return
    await prisma.$transaction([
      prisma.rsvpPerson.update({ where: { id: personId }, data: { checkedInAt: person.checkedInAt ?? now, leftAt: null } }),
      entry(rsvp, person.position, 'IN', now)
    ])
  }
  await syncRsvpCheckin(person.rsvpId)
}

/**
 * Antwort an ihre Personen angleichen: da gewesen, sobald eine Person da war; Zeitpunkt ist der früheste. Gegangen
 * (leftAt), wenn alle eingecheckten Personen weg sind - zum spätesten Zeitpunkt. Ohne Personenliste bleibt die Antwort
 * unverändert (dort gibt es nur den Haken der Antwort).
 */
export async function syncRsvpCheckin(rsvpId: string) {
  const persons = await prisma.rsvpPerson.findMany({ where: { rsvpId }, select: { checkedInAt: true, leftAt: true } })
  if (persons.length === 0) return
  const arrived = persons.filter(p => p.checkedInAt)
  const times = arrived.map(p => p.checkedInAt!).sort((a, b) => a.getTime() - b.getTime())
  const allLeft = arrived.length > 0 && arrived.every(p => p.leftAt)
  const leftAt = allLeft ? new Date(Math.max(...arrived.map(p => p.leftAt!.getTime()))) : null
  await prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: arrived.length > 0, checkedInAt: times[0] ?? null, leftAt } })
}

/**
 * Kommen und Gehen: letzte Änderung der Antwort zurücknehmen (falsch gescannt, falscher Knopf). Entfernt die jüngsten
 * Einträge (alle mit demselben Zeitpunkt - "alle einlassen" ist eine Änderung) und stellt den Stand der betroffenen
 * Personen aus den übrigen wieder her. Personen ohne Einträge (vor dem Einschalten eingecheckt) bleiben, wie sie sind.
 * false = nichts zurückzunehmen.
 */
export async function undoLastPresence(rsvpId: string): Promise<boolean> {
  const entries = await prisma.presenceEntry.findMany({ where: { rsvpId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })
  if (entries.length === 0) return false
  const lastAt = entries[entries.length - 1].at.getTime()
  const removed = entries.filter(e => e.at.getTime() === lastAt)
  const rest = entries.filter(e => e.at.getTime() !== lastAt)
  const stateOf = (position: number | null) => {
    const own = rest.filter(e => e.position === position)
    const last = own[own.length - 1]
    return { checkedInAt: own.find(e => e.kind === 'IN')?.at ?? null, leftAt: last?.kind === 'OUT' ? last.at : null }
  }
  const persons = await prisma.rsvpPerson.findMany({ where: { rsvpId }, select: { id: true, position: true } })
  const writes: Prisma.PrismaPromise<unknown>[] = [prisma.presenceEntry.deleteMany({ where: { id: { in: removed.map(e => e.id) } } })]
  for (const position of new Set(removed.map(e => e.position))) {
    const state = stateOf(position)
    const person = persons.find(p => p.position === position)
    if (position === null) writes.push(prisma.rsvp.update({ where: { id: rsvpId }, data: { hasAttended: !!state.checkedInAt, ...state } }))
    else if (person) writes.push(prisma.rsvpPerson.update({ where: { id: person.id }, data: state }))
  }
  await prisma.$transaction(writes)
  await syncRsvpCheckin(rsvpId)
  return true
}

export type PresenceEntryRow = { rsvpId: string; position: number | null; name: string; kind: string; at: Date }
export type PresenceStay = { from: Date; to: Date | null }
export type PresenceRow = { rsvpId: string; position: number | null; name: string; present: boolean; stays: PresenceStay[] }

/**
 * Anwesenheitsliste eines Termins (Reiter "Anwesenheit", CSV): pro Person mit Einträgen ihre Aufenthalte (kommen bis
 * gehen, offen = noch da), sortiert nach erstem Kommen, dazu der Verlauf. Rein, ohne Datenbank.
 */
export function presenceReport(entries: readonly PresenceEntryRow[]) {
  const timeline = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())
  const rows = new Map<string, PresenceRow>()
  for (const e of timeline) {
    const key = `${e.rsvpId}:${e.position ?? ''}`
    const row = rows.get(key) ?? { rsvpId: e.rsvpId, position: e.position, name: e.name, present: false, stays: [] }
    row.name = e.name
    const open = row.stays.length > 0 && row.stays[row.stays.length - 1].to === null
    if (e.kind === 'IN' && !open) row.stays.push({ from: e.at, to: null })
    if (e.kind === 'OUT' && open) row.stays[row.stays.length - 1].to = e.at
    row.present = row.stays.length > 0 && row.stays[row.stays.length - 1].to === null
    if (row.stays.length > 0) rows.set(key, row)
  }
  const list = [...rows.values()].sort((a, b) => a.stays[0].from.getTime() - b.stays[0].from.getTime() || a.name.localeCompare(b.name, 'de'))
  return { rows: list, timeline, presentCount: list.filter(r => r.present).length }
}

/** Personen mit festem Platz, die gerade da sind (Kennzahlen): eingecheckt und nicht gegangen. */
export function presentPersons(rsvps: readonly { isAttending: boolean; isOnWaitlist: boolean; hasAttended: boolean; leftAt?: Date | null; persons?: readonly { isAttending: boolean; checkedInAt?: Date | null; leftAt?: Date | null }[] | null }[]): number {
  return rsvps.filter(r => r.isAttending && !r.isOnWaitlist).reduce((sum, r) =>
    sum + (r.persons?.length ? r.persons.filter(p => p.isAttending && isPresent(p, true)).length : isPresent(r) ? 1 : 0), 0)
}
