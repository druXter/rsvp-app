// app/lib/tickets.ts
//
// Ticketkategorien und Kontingente (Idee L4 der Suite, docs/KONZEPT-TICKETS.md): Die Verwaltung legt pro
// Termin Kategorien mit Preis und optionalem Kontingent an, Gäste mit Zusage wählen eine davon. Ohne
// Kategorien verhält sich ein Termin wie bisher. Die Platzregel (hasRoom) gilt für alle Wege, die einen
// festen Platz vergeben: Antworten, Nachrücken (app/lib/waitlist.ts) und Verifizierung.
import { prisma } from './prisma'
import { seatsOf } from './persons'

export { formatEuro } from './payment-state'

export const TICKET_LIMITS = { categories: 10, label: 60, priceCents: 1_000_000, capacity: 100_000 }

export type TicketCategoryInput = { label: string; priceCents: number; capacity: number | null }
export type TicketCategoryForForm = TicketCategoryInput & { id: string; taken: number; full: boolean }

/** "25", "25,5", "25,50 €", "€ 25.50", "frei" -> Cent. Wirft bei allem anderen. */
export function parsePrice(text: string, label: string): number {
  const value = text.replace(/€|eur/gi, '').trim()
  if (value === '' || /^(frei|kostenlos)$/i.test(value)) return 0
  const match = value.match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/)
  if (!match) throw new Error(`Ticketkategorien: Der Preis „${text.trim()}“ bei „${label}“ ist ungültig (z. B. 25 oder 25,50).`)
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'))
  if (cents > TICKET_LIMITS.priceCents) throw new Error(`Ticketkategorien: Der Preis bei „${label}“ ist zu hoch.`)
  return cents
}

/**
 * Liest das Textfeld der Verwaltung: eine Zeile pro Kategorie, `Bezeichnung; Preis; Kontingent`, Preis und
 * Kontingent optional. Leere Zeilen zählen nicht. Wirft mit einer Meldung fürs Formular.
 */
export function parseTicketCategories(text: string): TicketCategoryInput[] {
  const result: TicketCategoryInput[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue
    const [labelPart, pricePart = '', capacityPart = '', ...rest] = raw.split(';').map(p => p.trim())
    const label = labelPart
    if (!label) throw new Error('Ticketkategorien: Jede Zeile braucht vorne eine Bezeichnung.')
    if (rest.some(p => p !== '')) throw new Error(`Ticketkategorien: Bei „${label}“ stehen zu viele Angaben (Bezeichnung; Preis; Kontingent).`)
    if (label.length > TICKET_LIMITS.label) throw new Error(`Ticketkategorien: „${label.slice(0, 30)}…“ ist zu lang (höchstens ${TICKET_LIMITS.label} Zeichen).`)
    if (result.some(c => c.label === label)) throw new Error(`Ticketkategorien: „${label}“ steht doppelt in der Liste.`)
    let capacity: number | null = null
    if (capacityPart !== '') {
      if (!/^\d+$/.test(capacityPart) || Number(capacityPart) < 1 || Number(capacityPart) > TICKET_LIMITS.capacity) {
        throw new Error(`Ticketkategorien: Das Kontingent bei „${label}“ muss eine ganze Zahl ab 1 sein.`)
      }
      capacity = Number(capacityPart)
    }
    result.push({ label, priceCents: parsePrice(pricePart, label), capacity })
  }
  if (result.length > TICKET_LIMITS.categories) throw new Error(`Ticketkategorien: höchstens ${TICKET_LIMITS.categories} Kategorien.`)
  return result
}

/** Gegenstück zu parseTicketCategories fürs Bearbeiten-Formular. */
export function formatTicketCategories(categories: readonly TicketCategoryInput[]): string {
  return categories.map(c => {
    const price = c.priceCents % 100 === 0 ? String(c.priceCents / 100) : (c.priceCents / 100).toFixed(2).replace('.', ',')
    if (c.capacity !== null) return `${c.label}; ${price}; ${c.capacity}`
    return c.priceCents > 0 ? `${c.label}; ${price}` : c.label
  }).join('\n')
}

/** Liest das Feld nur, wenn das Formular es überhaupt hat - sonst bleiben die Kategorien unangetastet (null). */
export function readTicketCategories(formData: FormData): TicketCategoryInput[] | null {
  return formData.has('ticketCategories') ? parseTicketCategories(formData.get('ticketCategories') as string || '') : null
}

/**
 * Eine Kategorie, die noch Antworten hat, lässt sich nicht entfernen (oder umbenennen) - sonst stünden Zusagen
 * ohne Kategorie und Betrag da. Vor dem Speichern des Termins aufrufen, damit nichts halb gespeichert wird.
 */
export async function assertCategoriesRemovable(eventId: string, categories: readonly TicketCategoryInput[] | null): Promise<void> {
  if (categories === null) return
  const keep = new Set(categories.map(c => c.label))
  const inUse = await prisma.ticketCategory.findFirst({
    where: { eventId, label: { notIn: [...keep] }, rsvps: { some: {} } },
    include: { _count: { select: { rsvps: true } } }
  })
  if (inUse) {
    throw new Error(`Ticketkategorien: „${inUse.label}“ hat schon ${inUse._count.rsvps} Antwort(en) und kann nicht entfernt oder umbenannt werden.`)
  }
}

/**
 * Speichert die Kategorien eines Termins per Abgleich nach Bezeichnung: bestehende behalten ihre Antworten
 * (ein neuer Preis gilt nur für neue Zusagen, siehe Rsvp.amountCents), neue kommen dazu, entfernte (ohne
 * Antworten, siehe assertCategoriesRemovable) gehen.
 */
export async function saveTicketCategories(eventId: string, categories: TicketCategoryInput[] | null): Promise<void> {
  if (categories === null) return
  await assertCategoriesRemovable(eventId, categories)
  const existing = await prisma.ticketCategory.findMany({ where: { eventId } })
  const keep = new Set(categories.map(c => c.label))
  const removed = existing.filter(c => !keep.has(c.label)).map(c => c.id)
  const byLabel = new Map(existing.map(c => [c.label, c]))
  await prisma.$transaction(async tx => {
    if (removed.length > 0) await tx.ticketCategory.deleteMany({ where: { id: { in: removed } } })
    for (const [position, category] of categories.entries()) {
      const current = byLabel.get(category.label)
      const data = { priceCents: category.priceCents, capacity: category.capacity, position }
      if (current) await tx.ticketCategory.update({ where: { id: current.id }, data })
      else await tx.ticketCategory.create({ data: { eventId, label: category.label, ...data } })
    }
  })
}

// --- Platzregel ---------------------------------------------------------------------------------

/** `seats`: Plätze, die die Antwort braucht (zusagende Personen ohne Kleinkinder, seatsOf), ohne Angabe 1. */
export type SeatHolder = { id: string; isAttending: boolean; isOnWaitlist: boolean; ticketCategoryId: string | null; seats?: number }
export type CapacityLimits = { maxCapacity: number | null; categories: readonly { id: string; capacity: number | null }[] }

const isFixed = (r: SeatHolder) => r.isAttending && !r.isOnWaitlist
const seatCount = (rsvps: readonly SeatHolder[]) => rsvps.reduce((sum, r) => sum + (r.seats ?? 1), 0)

/**
 * Hat eine Zusage der Kategorie `categoryId` mit `seats` Personen noch einen festen Platz? Der Termin insgesamt
 * (maxCapacity) und die Kategorie (capacity) müssen beide Platz für alle haben - Plätze zählen Personen, nicht
 * Antworten (docs/KONZEPT-EINLADUNGEN.md). `excludeRsvpId`: die Antwort selbst zählt nicht mit (beim Ändern
 * einer bestehenden Antwort).
 */
export function hasRoom(limits: CapacityLimits, rsvps: readonly SeatHolder[], categoryId: string | null, excludeRsvpId?: string | null, seats = 1): boolean {
  const fixed = rsvps.filter(r => isFixed(r) && r.id !== excludeRsvpId)
  if (limits.maxCapacity !== null && seatCount(fixed) + seats > limits.maxCapacity) return false
  const category = categoryId ? limits.categories.find(c => c.id === categoryId) : undefined
  if (category && category.capacity !== null && seatCount(fixed.filter(r => r.ticketCategoryId === category.id)) + seats > category.capacity) return false
  return true
}


/**
 * Wer rückt als Nächstes nach? Die am längsten wartende Zusage (`waiting` ist nach createdAt sortiert und
 * schon auf nachrückberechtigte gefiltert), für die gerade Platz ist - eine volle Kategorie blockiert also
 * nicht die Wartenden einer anderen, eine große Gruppe nicht die Einzelnen dahinter.
 */
export function nextToPromote<T extends SeatHolder>(limits: CapacityLimits, rsvps: readonly SeatHolder[], waiting: readonly T[]): T | null {
  const seatsOfWaiting = (r: T) => rsvps.find(s => s.id === r.id)?.seats ?? r.seats ?? 1
  return waiting.find(r => hasRoom(limits, rsvps, r.ticketCategoryId, r.id, seatsOfWaiting(r))) ?? null
}

/** Grenzen und belegte Plätze eines Termins aus der Datenbank, für hasRoom. */
export async function loadCapacity(eventId: string): Promise<{ limits: CapacityLimits; rsvps: SeatHolder[] }> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      maxCapacity: true,
      ticketCategories: { select: { id: true, capacity: true } },
      rsvps: { select: { id: true, isAttending: true, isOnWaitlist: true, ticketCategoryId: true, persons: { select: { isAttending: true, ageGroup: true } } } }
    }
  })
  const rsvps = event.rsvps.map(({ persons, ...r }) => ({ ...r, seats: seatsOf(persons) }))
  return { limits: { maxCapacity: event.maxCapacity, categories: event.ticketCategories }, rsvps }
}

/**
 * Kategorien fürs Gästeformular: Preis, belegte feste Plätze und ob die Kategorie voll ist. `ownRsvpId`: die
 * bestehende Antwort des Gasts zählt nicht mit (sein eigener Platz macht keine Kategorie voll).
 */
export async function ticketCategoriesForForm(eventId: string, ownRsvpId: string | null): Promise<TicketCategoryForForm[]> {
  const [categories, { limits, rsvps }] = await Promise.all([
    prisma.ticketCategory.findMany({ where: { eventId }, orderBy: { position: 'asc' } }),
    loadCapacity(eventId)
  ])
  return categories.map(c => ({
    id: c.id,
    label: c.label,
    priceCents: c.priceCents,
    capacity: c.capacity,
    taken: seatCount(rsvps.filter(r => isFixed(r) && r.ticketCategoryId === c.id)),
    full: !hasRoom(limits, rsvps, c.id, ownRsvpId)
  }))
}
