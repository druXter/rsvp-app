// app/lib/guest-invites.ts
import { Prisma, type Event, type EventSeries, type GuestUser, type User } from '@prisma/client'
import { prisma } from './prisma'
import { getCurrentGuestUser } from './guest-auth'
import { sendAccountInviteEmail } from './mail'

/**
 * Teilnehmendenkonten zu einem Termin einladen (GuestUserEvent): Der Termin erscheint in "Mein Konto" wie ein Termin
 * einer Reihe, und das eingeloggte Konto braucht dort keine PIN (app/lib/pin.ts) und antwortet mit seinem Konto
 * (performRsvpSubmission). Gilt für Einzel-Events und einzelne Termine einer Reihe, nicht im Einladungsmodus - der
 * hat mit Invitation seine eigenen, persönlichen Links.
 *
 * Wer einlädt, braucht Zugriff auf den Termin (mindestens Moderation) und sieht zur Auswahl nur Konten aus Events und
 * Reihen, auf die das eigene Konto ebenfalls Zugriff hat: Konten mit einer Antwort dort, Mitglieder einer Reihe und dort
 * schon eingeladene Konten. Hat ein Creator Zugriff auf Event A, aber nicht auf B, bleiben die Konten aus B unsichtbar -
 * und die Server Action prüft jede ausgewählte Kennung erneut gegen genau diese Auswahl. Nur bestätigte Konten.
 */

/** Höchstzahl Konten in der Auswahl - mehr wäre auf dem Handy ohnehin nicht bedienbar (Suche). */
const MAX_CANDIDATES = 1000

type Scope = { events: Prisma.EventWhereInput; series: Prisma.EventSeriesWhereInput }

/** Events und Reihen, auf die das Konto mindestens Moderationsrecht hat (wie hasEventModeratorOrAbove). */
async function accessScope(user: User): Promise<Scope> {
  if (user.role === 'ADMIN') return { events: {}, series: {} }
  const shared = await prisma.resourceAccess.findMany({ where: { userId: user.id }, select: { eventId: true, seriesId: true } })
  const eventIds = shared.flatMap(a => (a.eventId ? [a.eventId] : []))
  const seriesIds = shared.flatMap(a => (a.seriesId ? [a.seriesId] : []))
  const ownSeries = { OR: [{ ownerId: user.id }, { id: { in: seriesIds } }] }
  return {
    events: { OR: [{ ownerId: user.id }, { id: { in: eventIds } }, { series: ownSeries }] },
    series: ownSeries
  }
}

export type InviteCandidate = { id: string; name: string; email: string; sources: string[] }

type Target = { id: string; seriesId: string | null } | null

/**
 * Konten, die das Konto `user` zu `target` einladen darf (bzw. beim Anlegen: target null), nach Name sortiert, mit
 * Herkunft ("Sommerfest", "Reihe Stammtisch"). Schon eingeladene, Mitglieder der Reihe des Termins und Konten mit
 * Antwort auf den Termin fehlen - für sie ändert eine Einladung nichts.
 */
export async function inviteCandidates(user: User, target: Target): Promise<InviteCandidate[]> {
  const scope = await accessScope(user)
  const [answered, members, invited] = await Promise.all([
    prisma.participant.findMany({
      where: { guestUserId: { not: null }, rsvps: { some: { event: scope.events } } },
      select: { guestUserId: true, rsvps: { where: { event: scope.events }, select: { event: { select: { title: true, series: { select: { title: true } } } } } } }
    }),
    prisma.guestUserSeries.findMany({ where: { series: scope.series }, select: { guestUserId: true, series: { select: { title: true } } } }),
    prisma.guestUserEvent.findMany({ where: { event: scope.events }, select: { guestUserId: true, event: { select: { title: true } } } })
  ])

  const sources = new Map<string, Set<string>>()
  const add = (id: string | null, label: string) => {
    if (!id) return
    if (!sources.has(id)) sources.set(id, new Set())
    sources.get(id)!.add(label)
  }
  for (const p of answered) for (const r of p.rsvps) add(p.guestUserId, r.event.series ? `Reihe ${r.event.series.title}` : r.event.title)
  for (const m of members) add(m.guestUserId, `Reihe ${m.series.title}`)
  for (const i of invited) add(i.guestUserId, i.event.title)

  if (target) for (const id of await alreadyReached(target)) sources.delete(id)
  const users = await prisma.guestUser.findMany({
    where: { id: { in: [...sources.keys()] }, isVerified: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: MAX_CANDIDATES
  })
  return users.map(u => ({ ...u, sources: [...sources.get(u.id)!].sort((a, b) => a.localeCompare(b, 'de')) }))
}

/** Konten, die den Termin schon sehen: eingeladen, Mitglied seiner Reihe oder mit Antwort darauf. */
async function alreadyReached(target: { id: string; seriesId: string | null }): Promise<Set<string>> {
  const [invited, members, answered] = await Promise.all([
    prisma.guestUserEvent.findMany({ where: { eventId: target.id }, select: { guestUserId: true } }),
    target.seriesId ? prisma.guestUserSeries.findMany({ where: { seriesId: target.seriesId }, select: { guestUserId: true } }) : [],
    prisma.participant.findMany({ where: { guestUserId: { not: null }, rsvps: { some: { eventId: target.id } } }, select: { guestUserId: true } })
  ])
  return new Set([...invited, ...members, ...answered].flatMap(r => (r.guestUserId ? [r.guestUserId] : [])))
}

/** Gibt es für diesen Termin Einladungen von Konten? (nicht im Einladungsmodus) */
export function canInviteAccounts(event: { inviteOnly: boolean }): boolean {
  return !event.inviteOnly
}

/**
 * Lädt die ausgewählten Konten ein. Jede Kennung muss in der Auswahl von `user` stehen (inviteCandidates) - alles
 * andere wird still übergangen, ebenso schon eingeladene Konten. Mit `notify` bekommt jedes neu eingeladene Konto eine
 * Mail. Gibt die Zahl der neuen Einladungen zurück.
 */
export async function inviteAccounts(
  user: User, event: Event & { series: EventSeries | null }, guestUserIds: string[], notify: boolean
): Promise<number> {
  if (!canInviteAccounts(event) || guestUserIds.length === 0) return 0
  const allowed = new Set((await inviteCandidates(user, event)).map(c => c.id))
  let created = 0
  for (const guestUserId of new Set(guestUserIds)) {
    if (!allowed.has(guestUserId)) continue
    let row
    try {
      row = await prisma.guestUserEvent.create({ data: { guestUserId, eventId: event.id, invitedById: user.id }, include: { guestUser: true } })
    } catch (error) {
      // Gleichzeitig schon eingeladen (Doppelklick): nichts doppelt, keine zweite Mail
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
      throw error
    }
    created++
    if (notify) await sendAccountInviteEmail(row.guestUser, event)
  }
  return created
}

/** Die eingeladenen Konten eines Termins (für den Reiter "Gäste"). */
export function invitedAccounts(eventId: string) {
  return prisma.guestUserEvent.findMany({
    where: { eventId },
    select: { id: true, hiddenAt: true, createdAt: true, guestUser: { select: { name: true, email: true } }, invitedBy: { select: { email: true } } },
    orderBy: { createdAt: 'asc' }
  })
}

/** Ist dieses Konto zu genau diesem Termin eingeladen? */
export async function isInvited(guestUserId: string, eventId: string): Promise<boolean> {
  return !!(await prisma.guestUserEvent.findUnique({ where: { guestUserId_eventId: { guestUserId, eventId } }, select: { id: true } }))
}

/** Das eingeloggte Teilnehmendenkonto, wenn es zu diesem Termin eingeladen ist (nicht im Einladungsmodus). */
export async function invitedGuestUser(event: { id: string; inviteOnly?: boolean }): Promise<GuestUser | null> {
  if (event.inviteOnly) return null
  const guestUser = await getCurrentGuestUser()
  return guestUser && (await isInvited(guestUser.id, event.id)) ? guestUser : null
}
