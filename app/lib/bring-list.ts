// app/lib/bring-list.ts
//
// Mitbringliste (Idee L5 der Suite, suite-kit docs/IDEEN.md): Die Verwaltung legt pro Termin Einträge mit
// Anzahl an ("2x Salat", "Nachtisch"), Gäste mit Zusage beanspruchen beim Antworten je einen Platz eines
// Eintrags. Ergänzt das Freitextfeld "Mitbringsel", ersetzt es nicht.
import { randomUUID } from 'node:crypto'
import { prisma } from './prisma'
import { InputError } from './input-error'


export const BRING_LIMITS = { slots: 30, label: 80, quantity: 50 }

export type BringSlotInput = { label: string; quantity: number }
export type BringSlotForForm = { id: string; label: string; quantity: number; claimed: number; mine: boolean }

/**
 * Liest das Textfeld der Verwaltung: eine Zeile pro Eintrag, optional mit Anzahl vorne ("2x Salat",
 * "2 x Salat", "2× Salat"), sonst Anzahl 1. Leere Zeilen zählen nicht, doppelte Bezeichnungen werden
 * zusammengefasst (Anzahl addiert). Wirft mit einer Meldung fürs Formular.
 */
export function parseBringSlots(text: string): BringSlotInput[] {
  const result: BringSlotInput[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^(\d+)\s*[x×]\s+(.+)$/i)
    const quantity = match ? Number(match[1]) : 1
    const label = (match ? match[2] : line).trim()
    if (quantity < 1 || quantity > BRING_LIMITS.quantity) {
      throw new InputError(`Mitbringliste: Die Anzahl bei "${label}" muss zwischen 1 und ${BRING_LIMITS.quantity} liegen.`)
    }
    if (label.length > BRING_LIMITS.label) throw new InputError(`Mitbringliste: "${label.slice(0, 30)}…" ist zu lang (höchstens ${BRING_LIMITS.label} Zeichen).`)
    const existing = result.find(s => s.label === label)
    if (existing) existing.quantity = Math.min(existing.quantity + quantity, BRING_LIMITS.quantity)
    else result.push({ label, quantity })
  }
  if (result.length > BRING_LIMITS.slots) throw new InputError(`Mitbringliste: höchstens ${BRING_LIMITS.slots} Einträge.`)
  return result
}

/** Gegenstück zu parseBringSlots fürs Bearbeiten-Formular. */
export function formatBringSlots(slots: readonly BringSlotInput[]): string {
  return slots.map(s => (s.quantity === 1 ? s.label : `${s.quantity}x ${s.label}`)).join('\n')
}

/** Liest das Feld nur, wenn das Formular es überhaupt hat - sonst bleibt die Liste unangetastet (null). */
export function readBringSlots(formData: FormData): BringSlotInput[] | null {
  return formData.has('bringSlots') ? parseBringSlots(formData.get('bringSlots') as string || '') : null
}

/**
 * Vorlage einer Reihe (EventSeries.bringTemplate) aus deren Einstellungen: normalisiert im Format des Textfelds,
 * null = keine Vorlage, undefined = Feld nicht im Formular (unverändert lassen). Wirft wie parseBringSlots.
 */
export function readBringTemplate(formData: FormData): string | null | undefined {
  if (!formData.has('bringTemplate')) return undefined
  return formatBringSlots(parseBringSlots(formData.get('bringTemplate') as string || '')) || null
}

/**
 * Übernimmt die Vorlage einer Reihe in einen Termin - nur, wenn er noch keine eigene Liste hat. Eine einmal
 * übernommene Liste gehört dem Termin und lässt sich dort frei ändern; spätere Änderungen der Vorlage
 * überschreiben sie nie. Gibt zurück, ob etwas übernommen wurde.
 */
export async function applyBringTemplate(eventId: string, template: string | null): Promise<boolean> {
  if (!template) return false
  let slots: BringSlotInput[]
  try {
    slots = parseBringSlots(template)
  } catch {
    // Gespeicherte Vorlagen sind geprüft; passt eine nach geänderten Grenzen nicht mehr, bleibt der Termin ohne Liste.
    return false
  }
  if (slots.length === 0 || (await prisma.bringSlot.count({ where: { eventId } })) > 0) return false
  await prisma.bringSlot.createMany({ data: slots.map((slot, position) => ({ eventId, label: slot.label, quantity: slot.quantity, position })) })
  return true
}

/**
 * Speichert die Liste eines Termins per Abgleich nach Bezeichnung: Bestehende Einträge behalten ihre
 * Beanspruchungen (neue Anzahl und Reihenfolge), entfernte Einträge nehmen ihre mit, neue kommen dazu.
 * Wird die Anzahl unter die Zahl der Beanspruchungen gesenkt, bleiben alle bestehen ("3/2").
 */
export async function saveBringSlots(eventId: string, slots: BringSlotInput[] | null): Promise<void> {
  if (slots === null) return
  const existing = await prisma.bringSlot.findMany({ where: { eventId } })
  const byLabel = new Map(existing.map(s => [s.label, s]))
  await prisma.$transaction(async tx => {
    const keep = new Set(slots.map(s => s.label))
    const removed = existing.filter(s => !keep.has(s.label)).map(s => s.id)
    if (removed.length > 0) await tx.bringSlot.deleteMany({ where: { id: { in: removed } } })
    for (const [position, slot] of slots.entries()) {
      const current = byLabel.get(slot.label)
      if (current) await tx.bringSlot.update({ where: { id: current.id }, data: { quantity: slot.quantity, position } })
      else await tx.bringSlot.create({ data: { eventId, label: slot.label, quantity: slot.quantity, position } })
    }
  })
}

/**
 * Beansprucht einen Platz - oder nicht, wenn der Eintrag voll ist. Zählen und Einfügen in EINER Anweisung:
 * SQLite führt sie atomar aus, so bleibt es auch bei gleichzeitigen Zusagen bei höchstens `quantity`
 * Beanspruchungen (zwei getrennte Schritte ließen beide durch). Schon beansprucht: nichts passiert.
 */
async function claimBringSlot(slot: { id: string; quantity: number }, rsvpId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "BringClaim" ("id", "slotId", "rsvpId", "createdAt")
    SELECT ${randomUUID()}, ${slot.id}, ${rsvpId}, ${Date.now()}
    WHERE (SELECT COUNT(*) FROM "BringClaim" WHERE "slotId" = ${slot.id}) < ${slot.quantity}
    ON CONFLICT ("slotId", "rsvpId") DO NOTHING`
}

/**
 * Gleicht die Beanspruchungen einer Antwort ab. `active` = Zusage, die zählt (nicht auf der Warteliste):
 * sonst werden alle freigegeben. `wanted` = die angekreuzten Einträge; undefined (Client-API, Formular ohne
 * Liste) lässt bestehende Beanspruchungen unangetastet. Einträge anderer Termine werden ignoriert.
 */
export async function syncBringClaims(rsvpId: string, eventId: string, wanted: string[] | undefined, active: boolean): Promise<void> {
  if (!active) {
    await prisma.bringClaim.deleteMany({ where: { rsvpId } })
    return
  }
  if (wanted === undefined) return
  const wantedIds = new Set(wanted)
  await prisma.bringClaim.deleteMany({ where: { rsvpId, slotId: { notIn: [...wantedIds] } } })
  const slots = await prisma.bringSlot.findMany({ where: { eventId, id: { in: [...wantedIds] } }, select: { id: true, quantity: true } })
  for (const slot of slots) await claimBringSlot(slot, rsvpId)
}

/** Einträge eines Termins fürs Gästeformular: belegt/gesamt und ob die eigene Antwort einen Platz hat. */
export async function bringSlotsForForm(eventId: string, rsvpId: string | null): Promise<BringSlotForForm[]> {
  const slots = await prisma.bringSlot.findMany({
    where: { eventId },
    orderBy: { position: 'asc' },
    select: { id: true, label: true, quantity: true, claims: { select: { rsvpId: true } } }
  })
  return slots.map(s => ({ id: s.id, label: s.label, quantity: s.quantity, claimed: s.claims.length, mine: !!rsvpId && s.claims.some(c => c.rsvpId === rsvpId) }))
}

/** Bezeichnungen der beanspruchten Einträge einer Antwort, für Gästeliste, Verwaltung und CSV. */
export function claimedLabels(rsvp: { bringClaims?: { slot: { label: string; position: number } }[] }): string[] {
  return (rsvp.bringClaims ?? []).slice().sort((a, b) => a.slot.position - b.slot.position).map(c => c.slot.label)
}
