// app/lib/wishlist-store.ts
//
// Datenbankseite der Wunschliste (app/lib/wishlist.ts, docs/KONZEPT-WUNSCHLISTE.md).
import { randomUUID } from 'crypto'
import { prisma } from './prisma'
import { invitationCovers } from './invitations'
import { WishInputError, wishState, type WishInput, type WishState } from './wishlist'

/** Ein Wunsch fürs Gästeformular - ohne Reservierungen anderer, nur deren Summe. */
export type WishForGuest = {
  id: string; title: string; description: string | null; url: string | null; priceCents: number | null
  quantity: number; targetCents: number | null; state: WishState
}

/** Wie WishInputError: Meldung fürs Formular (vergeben, zu viele, Wunsch weg). */
export class WishError extends WishInputError {}

/** Wünsche eines Termins mit Stand; `participantId`: wessen eigene Reservierung mitgeliefert wird. */
export async function wishesForGuest(eventId: string, participantId: string | null): Promise<WishForGuest[]> {
  const wishes = await prisma.wish.findMany({
    where: { eventId },
    orderBy: { position: 'asc' },
    include: { reservations: { select: { participantId: true, quantity: true, amountCents: true } } }
  })
  return wishes.map(w => ({
    id: w.id, title: w.title, description: w.description, url: w.url, priceCents: w.priceCents, quantity: w.quantity, targetCents: w.targetCents,
    state: wishState(w, w.reservations, participantId)
  }))
}

/**
 * Darf dieser Gast auf der Wunschliste reservieren? Nur über seinen persönlichen Link (Participant) und nur, wenn er
 * zu diesem Termin geantwortet hat (auch eine Absage - schenken kann man trotzdem) oder zu ihm eingeladen ist.
 */
export async function guestOfEvent(editToken: string, eventId: string) {
  const participant = await prisma.participant.findUnique({ where: { editToken }, select: { id: true } })
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, seriesId: true, wishlist: true } })
  if (!participant || !event || !event.wishlist) return null
  const [rsvp, invitation] = await Promise.all([
    prisma.rsvp.findUnique({ where: { eventId_participantId: { eventId, participantId: participant.id } }, select: { id: true } }),
    prisma.invitation.findUnique({ where: { participantId: participant.id }, include: { events: { select: { eventId: true } } } })
  ])
  if (!rsvp && !(invitation && invitationCovers(invitation, event))) return null
  return { participantId: participant.id, event }
}

/**
 * Reserviert `quantity` Stück eines Geschenks bzw. `amountCents` bei einem Geldwunsch - ersetzt die eigene
 * bisherige Reservierung. Bei Geschenken prüft EINE SQL-Anweisung die freie Menge und fügt ein (wie
 * claimBringSlot), in derselben Transaktion wie das Entfernen der alten: Gleichzeitige Reservierungen können
 * zusammen nie mehr als `Wish.quantity` ergeben, und wer nicht mehr genug bekommt, behält seine bisherige.
 */
export async function reserveWish(wishId: string, eventId: string, participantId: string, request: { quantity?: number; amountCents?: number }) {
  const wish = await prisma.wish.findFirst({ where: { id: wishId, eventId } })
  if (!wish) throw new WishError('Diesen Wunsch gibt es nicht mehr.')
  if (wish.targetCents !== null) {
    const amountCents = request.amountCents
    if (!amountCents || amountCents <= 0) throw new WishError('Bitte einen Betrag eintragen.')
    await prisma.wishReservation.upsert({
      where: { wishId_participantId: { wishId, participantId } },
      create: { wishId, participantId, quantity: 1, amountCents },
      update: { amountCents }
    })
    return
  }
  const quantity = request.quantity ?? 1
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > wish.quantity) throw new WishError(`Bitte 1 bis ${wish.quantity} Stück wählen.`)
  await prisma.$transaction(async tx => {
    await tx.wishReservation.deleteMany({ where: { wishId, participantId } })
    const inserted = await tx.$executeRaw`
      INSERT INTO "WishReservation" ("id", "wishId", "participantId", "quantity", "createdAt")
      SELECT ${randomUUID()}, ${wishId}, ${participantId}, ${quantity}, ${Date.now()}
      WHERE (SELECT COALESCE(SUM("quantity"), 0) FROM "WishReservation" WHERE "wishId" = ${wishId}) + ${quantity} <= ${wish.quantity}`
    if (inserted !== 1) throw new WishError(quantity === 1 ? 'Das ist leider schon vergeben.' : `So viele sind nicht mehr frei - bitte weniger wählen.`)
  })
}

export async function releaseWish(wishId: string, participantId: string) {
  await prisma.wishReservation.deleteMany({ where: { wishId, participantId } })
}

// --- Verwaltung ---------------------------------------------------------------------------------

export async function createWish(eventId: string, input: WishInput) {
  const count = await prisma.wish.count({ where: { eventId } })
  if (count >= 100) throw new WishError('Höchstens 100 Wünsche pro Termin.')
  const last = await prisma.wish.findFirst({ where: { eventId }, orderBy: { position: 'desc' }, select: { position: true } })
  await prisma.wish.create({ data: { eventId, ...input, position: (last?.position ?? -1) + 1 } })
}

/**
 * Ändert einen Wunsch. Eine Stückzahl unter dem bereits Reservierten oder ein Wechsel zwischen Geschenk und
 * Geldwunsch mit Reservierungen geht nicht - sonst stünden Zusagen der Gäste ohne Gegenstück da.
 */
export async function updateWish(wishId: string, input: WishInput) {
  const wish = await prisma.wish.findUniqueOrThrow({ where: { id: wishId }, include: { reservations: true } })
  if (wish.reservations.length > 0 && (wish.targetCents === null) !== (input.targetCents === null)) {
    throw new WishError('Schon reserviert: Ein Geschenk lässt sich nicht mehr in einen Geldwunsch umwandeln (oder umgekehrt).')
  }
  const reserved = wish.reservations.reduce((sum, r) => sum + r.quantity, 0)
  if (input.targetCents === null && input.quantity < reserved) throw new WishError(`Schon ${reserved} Stück reserviert - die Anzahl kann nicht kleiner sein.`)
  await prisma.wish.update({ where: { id: wishId }, data: input })
}

export async function deleteWish(wishId: string) {
  await prisma.wish.delete({ where: { id: wishId } })
}
