// app/lib/seating-notify.ts
import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { createMessage, guestOf, isSeatingConfirmed, seatingLinkOf, seatingSecret, type SeatingGuest } from './seating'

/**
 * Webhook an Seating (typ "rsvp-change", siehe app/lib/seating.ts): "diese Zusage hat sich
 * geändert" - neu, geändert, abgesagt, auf die Warteliste, nachgerückt, verifiziert, Begleitung
 * geändert oder gelöscht. Seating storniert bei attending false eine Platzbuchung bzw. markiert
 * die Sitzordnung als "bitte abgleichen".
 *
 * Best-effort mit 5 s Timeout wie poll-notify.ts, aber zusätzlich über after(): Die Meldung
 * läuft erst NACH der Antwort an den Browser, damit ein langsames oder nicht erreichbares
 * Seating die RSVP-Abgabe nie verzögert oder scheitern lässt. Der Stand wird erst dann aus der
 * Datenbank gelesen - gemeldet wird also immer der aktuelle, nie ein zwischenzeitlicher.
 */

type SeatingChange = { url: string; body: string }

type RsvpState = {
  id: string
  isAttending: boolean
  isOnWaitlist: boolean
  plusOne: boolean
  plusOneName: string | null
  participant: { name: string; email: string | null; isVerified: boolean }
  event: {
    id: string
    seatingUrl: string | null
    requireVerification: boolean
    series: { requireVerification: boolean } | null
  }
}

const RSVP_STATE = {
  id: true, isAttending: true, isOnWaitlist: true, plusOne: true, plusOneName: true,
  participant: { select: { name: true, email: true, isVerified: true } },
  event: { select: { id: true, seatingUrl: true, requireVerification: true, series: { select: { requireVerification: true } } } }
} as const

/** Nachricht zu einer Zusage bauen - null, wenn ihr Termin nicht (gültig) mit Seating verknüpft ist. */
function changeOf(rsvp: RsvpState, deleted: boolean): SeatingChange | null {
  const secret = seatingSecret()
  const link = seatingLinkOf(rsvp.event)
  if (!secret || !link) return null
  const requireVerification = rsvp.event.series ? rsvp.event.series.requireVerification : rsvp.event.requireVerification
  const guest: SeatingGuest = guestOf(rsvp, rsvp.participant)
  const attending = !deleted && isSeatingConfirmed(rsvp, rsvp.participant, requireVerification)
  const body = createMessage('rsvp-change', {
    aud: link.origin, seatingEventId: link.seatingEventId, rsvpEventId: rsvp.event.id, ...guest, attending
  }, secret)
  return { url: `${link.origin}/api/rsvp-webhook`, body }
}

async function deliver(changes: SeatingChange[]) {
  // Nacheinander, damit Seating die Meldungen in derselben Reihenfolge sieht.
  for (const change of changes) {
    try {
      await fetch(change.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: change.body,
        signal: AbortSignal.timeout(5000)
      })
    } catch {
      // Best-effort - ein Fehlschlag darf nirgendwo sonst sichtbar werden. Verlorene Meldungen
      // heilt Seatings Abgleich (guest-list).
    }
  }
}

/** Nach der Antwort ausführen; außerhalb eines Request-Kontexts (Skripte) einfach im Hintergrund. */
function schedule(task: () => Promise<void>) {
  const run = () => task().catch(error => console.error('Fehler bei der Seating-Benachrichtigung:', error))
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Meldet den aktuellen Stand dieser Zusagen an Seating. Zusagen ohne verknüpften Termin werden
 * übersprungen; ist die Anbindung nicht eingerichtet, passiert gar nichts (auch keine Abfrage).
 */
export function notifySeatingOfRsvps(rsvpIds: (string | null | undefined)[]) {
  const ids = [...new Set(rsvpIds.filter((id): id is string => !!id))]
  if (ids.length === 0 || !seatingSecret()) return
  schedule(async () => {
    const rsvps = await prisma.rsvp.findMany({
      where: { id: { in: ids }, event: { seatingUrl: { not: null } } },
      select: RSVP_STATE
    })
    await deliver(rsvps.map(r => changeOf(r, false)).filter((c): c is SeatingChange => c !== null))
  })
}

/** Alle Zusagen eines Participants (z.B. nach einer Profil- oder Verifizierungsänderung) - nur künftige Termine. */
export function notifySeatingOfParticipants(participantIds: string[]) {
  if (participantIds.length === 0 || !seatingSecret()) return
  schedule(async () => {
    const rsvps = await prisma.rsvp.findMany({
      where: { participantId: { in: participantIds }, event: { seatingUrl: { not: null }, date: { gte: new Date() } } },
      select: RSVP_STATE
    })
    await deliver(rsvps.map(r => changeOf(r, false)).filter((c): c is SeatingChange => c !== null))
  })
}

/**
 * Vor dem Löschen aufrufen: liest die betroffenen Zusagen (solange es sie noch gibt), baut die
 * Meldungen "attending false" sofort und verschickt sie nach der Antwort. Filter wie bei
 * prisma.rsvp.findMany - z.B. { participantId } oder { eventId: { in: [...] } }.
 */
export async function notifySeatingBeforeDelete(where: Prisma.RsvpWhereInput) {
  if (!seatingSecret()) return
  const rsvps = await prisma.rsvp.findMany({
    where: { AND: [where, { event: { seatingUrl: { not: null } } }] },
    select: RSVP_STATE
  })
  const changes = rsvps.map(r => changeOf(r, true)).filter((c): c is SeatingChange => c !== null)
  if (changes.length > 0) schedule(() => deliver(changes))
}
