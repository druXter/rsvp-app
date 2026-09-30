// app/lib/poll-date.ts
import { randomBytes } from 'node:crypto'
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { extractPollId, type PollDateOwner } from './poll-verification'
import { notifyAttendeesOfChange } from './event-change-notify'
import { formatEventDate } from './event-date'

/**
 * Terminabstimmung mit dem Abstimmungstool (Gegenstück dort: app/lib/rsvp-date.ts). Das
 * Abstimmungstool bestätigt bzw. entscheidet den Termin selbst (nie vollautomatisch) und meldet
 * ihn dann hierher (POST /api/poll-date). Zwei Fälle:
 *
 * 1. Es gibt Events, deren pollUrl auf GENAU diese Abstimmung zeigt: Das ist zugleich die
 *    Zustimmung ihrer Verwaltung - nur wer ein Event verwaltet, kann dessen pollUrl setzen. Alle
 *    davon mit "Datum noch offen" (Event.datePending) bekommen den Termin; wer zugesagt hat, wird
 *    wie bei einer Terminänderung benachrichtigt (außer Adressen, die das Abstimmungstool selbst
 *    benachrichtigt - skipEmailHashes). Events mit festem Datum bleiben unangetastet.
 * 2. Es gibt keins, und die Verwaltung dort wünscht ein neues: Nur wenn der Owner der Abstimmung
 *    hier ein Konto mit eigener Event-Berechtigung hat, das über den Suite-Verbund verknüpft ist
 *    (resolvePollOwner) - ihm gehört das neue Event dann.
 *
 * Adressen und Secret des Abstimmungstools stehen nur in der .env (ABSTIMMUNGSTOOL_BASE_URL,
 * POLL_VERIFICATION_SECRET); eine pollUrl zählt nur, wenn ihr Origin genau dazu passt.
 */

export function abstimmungstoolOrigin(): string | null {
  const url = process.env.ABSTIMMUNGSTOOL_BASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Zeigt diese pollUrl auf genau diese Abstimmung des eingerichteten Abstimmungstools? */
export function pointsToPoll(pollUrl: string | null, pollId: string, origin: string): boolean {
  if (!pollUrl) return false
  try {
    return new URL(pollUrl).origin === origin && extractPollId(pollUrl) === pollId
  } catch {
    return false
  }
}

async function linkedEvents(pollId: string, origin: string) {
  const candidates = await prisma.event.findMany({
    where: { pollUrl: { contains: pollId } },
    select: { id: true, title: true, slug: true, pollUrl: true, datePending: true, seriesId: true, series: { select: { slug: true } } }
  })
  return candidates.filter(event => pointsToPoll(event.pollUrl, pollId, origin))
}

/**
 * Das rsvp-app-Konto zum Owner der Abstimmung - nur über eine Verbund-Verknüpfung, nie über die
 * E-Mail: entweder hier angelegt (ExternalIdentity mit dem Abstimmungstool als Anbieter) oder
 * dort (dann schickt das Abstimmungstool unsere Konto-ID mit, die es aus einer von uns
 * signierten Anmeldung kennt). Nur Konten, die eigene Events besitzen dürfen (kein MODERATOR).
 */
export async function resolvePollOwner(owner: PollDateOwner, origin: string) {
  const identity = await prisma.externalIdentity.findUnique({
    where: { issuer_subject: { issuer: origin, subject: owner.toolUserId } },
    select: { userId: true }
  })
  const userId = identity?.userId ?? owner.rsvpUserId
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
  return user && user.role !== 'MODERATOR' ? user : null
}

function publicUrl(event: { slug: string; series: { slug: string } | null }): string {
  return `${baseUrl()}${event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`}`
}

export async function pollDateStatus(pollId: string, owner: PollDateOwner, origin: string) {
  const events = await linkedEvents(pollId, origin)
  const canCreate = events.length === 0 && (await resolvePollOwner(owner, origin)) !== null
  return { events: events.map(e => ({ id: e.id, title: e.title, datePending: e.datePending })), canCreate }
}

function slugFor(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'termin'
  return `${base}-${randomBytes(3).toString('hex')}`
}

export async function applyPollDate(
  message: { pollId: string; pollTitle: string; startsAt: Date; owner: PollDateOwner; create: boolean; skipEmailHashes: string[] },
  origin: string
) {
  const events = await linkedEvents(message.pollId, origin)
  const updated: { id: string; title: string; url: string }[] = []

  for (const event of events.filter(e => e.datePending)) {
    // Bedingung im WHERE: Eine wiederholte Meldung (oder zwei gleichzeitige) setzt das Datum
    // und benachrichtigt nur einmal.
    const changed = await prisma.event.updateMany({
      where: { id: event.id, datePending: true },
      data: { date: message.startsAt, datePending: false, icsSequence: { increment: 1 } }
    })
    if (changed.count === 0) continue
    updated.push({ id: event.id, title: event.title, url: publicUrl(event) })
    await notifyAttendeesOfChange(
      event.id,
      [{ label: 'Datum', detail: `${formatEventDate({ date: message.startsAt })} (per Terminabstimmung festgelegt)` }],
      { skipEmailHashes: message.skipEmailHashes }
    )
  }

  let created: { id: string; title: string; url: string; adminUrl: string } | null = null
  // Neues Event nur, wenn noch KEIN Event auf die Abstimmung zeigt - auch keins mit festem
  // Datum. Das macht eine wiederholte Meldung zugleich harmlos: Das neue Event trägt die
  // pollUrl, beim zweiten Mal gibt es also schon eins.
  if (message.create && events.length === 0) {
    const owner = await resolvePollOwner(message.owner, origin)
    if (owner) {
      const event = await prisma.event.create({
        data: {
          ownerId: owner.id,
          title: message.pollTitle,
          slug: slugFor(message.pollTitle),
          date: message.startsAt,
          pollUrl: `${origin}/${message.pollId}`
        },
        select: { id: true, title: true, slug: true }
      })
      created = { id: event.id, title: event.title, url: publicUrl({ slug: event.slug, series: null }), adminUrl: `${baseUrl()}/admin/edit/${event.id}` }
    }
  }

  return {
    updated,
    created,
    // Verknüpfte Events mit schon festem Datum - zur Information, sie werden nicht geändert.
    unchanged: events.filter(e => !e.datePending).map(e => ({ id: e.id, title: e.title }))
  }
}
