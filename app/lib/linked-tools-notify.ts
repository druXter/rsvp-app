// app/lib/linked-tools-notify.ts
import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { configuredTools, linkedToolsOf, type ConfiguredTool, type StoredToolLink, type ToolLink, type ToolType } from './linked-tools'
import { seatingRsvpChange } from './seating'
import { timelineRsvpChange } from './timeline'
import { TOOL_LINKS } from './linked-tools-store'

/**
 * Webhook "rsvp-change" an ALLE Tools, mit denen der Termin einer Zusage verknüpft ist (siehe
 * app/lib/linked-tools.ts): "diese Zusage hat sich geändert" - neu, geändert, abgesagt, auf die
 * Warteliste, nachgerückt, verifiziert, Begleitung geändert oder gelöscht. Jedes Tool bekommt
 * seine eigene Nachricht, signiert mit SEINEM Secret, adressiert an SEINEN Origin, mit dem
 * Inhalt aus SEINEM Vertrag (RSVP_CHANGE unten). Tools ohne Verknüpfung mit diesem Termin,
 * nicht eingerichtete Tools und unbekannte Typen bekommen nichts.
 *
 * Best-effort mit 5 s Timeout wie poll-notify.ts, aber zusätzlich über after(): Die Meldung
 * läuft erst NACH der Antwort an den Browser, damit ein langsames oder nicht erreichbares Tool
 * die RSVP-Abgabe nie verzögert oder scheitern lässt. Der Stand wird erst dann aus der
 * Datenbank gelesen - gemeldet wird also immer der aktuelle, nie ein zwischenzeitlicher.
 */

export type RsvpState = {
  id: string
  isAttending: boolean
  isOnWaitlist: boolean
  plusOne: boolean
  plusOneName: string | null
  participant: { name: string; email: string | null; isVerified: boolean }
  event: {
    id: string
    requireVerification: boolean
    series: { requireVerification: boolean } | null
    toolLinks: StoredToolLink[]
  }
}

const RSVP_STATE = {
  id: true, isAttending: true, isOnWaitlist: true, plusOne: true, plusOneName: true,
  participant: { select: { name: true, email: true, isVerified: true } },
  event: { select: { id: true, requireVerification: true, series: { select: { requireVerification: true } }, toolLinks: TOOL_LINKS } }
} as const

/** Nur Zusagen, deren Termin überhaupt eine Verknüpfung hat - ob sie gilt, prüft linkedToolsOf. */
const HAS_TOOL_LINK: Prisma.RsvpWhereInput = { event: { toolLinks: { some: {} } } }

type ChangeInput = {
  link: ToolLink
  secret: string
  rsvpEventId: string
  rsvp: RsvpState
  participant: RsvpState['participant']
  requireVerification: boolean
  deleted: boolean
}

/** Inhalt des Webhooks je Tool - Vertrag des jeweiligen Tools. */
const RSVP_CHANGE: Record<ToolType, (input: ChangeInput) => string> = {
  seating: seatingRsvpChange,
  timeline: timelineRsvpChange
}

export type Delivery = { url: string; body: string }
export type NotifiableTool = ConfiguredTool & { rsvpChange: (input: ChangeInput) => string }

function notifiableTools(): NotifiableTool[] {
  return configuredTools().map(tool => ({ ...tool, rsvpChange: RSVP_CHANGE[tool.definition.type as ToolType] }))
}

/**
 * Die Meldungen zu einer Zusage: eine je gültig verknüpftem Tool ihres Termins, an
 * `<Origin des Tools><webhookPath>`. Ohne Datenbank - `tools` lässt sich in Tests ersetzen.
 */
export function deliveriesFor(rsvp: RsvpState, deleted: boolean, tools: NotifiableTool[] = notifiableTools()): Delivery[] {
  const requireVerification = rsvp.event.series ? rsvp.event.series.requireVerification : rsvp.event.requireVerification
  return linkedToolsOf(rsvp.event, tools).map(({ tool, link }) => ({
    url: `${link.origin}${tool.definition.webhookPath}`,
    body: tool.rsvpChange({
      link, secret: tool.secret, rsvpEventId: rsvp.event.id, rsvp, participant: rsvp.participant, requireVerification, deleted
    })
  }))
}

async function post(delivery: Delivery) {
  try {
    await fetch(delivery.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: delivery.body,
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    // Best-effort - ein Fehlschlag darf nirgendwo sonst sichtbar werden. Verlorene Meldungen
    // heilt der Abgleich des Tools (Seating: guest-list).
  }
}

/**
 * Pro Tool (Webhook-Adresse) nacheinander, damit es die Meldungen in derselben Reihenfolge sieht;
 * verschiedene Tools parallel, damit ein langsames Tool die anderen nicht aufhält.
 */
export async function deliver(deliveries: Delivery[]) {
  const byTarget = new Map<string, Delivery[]>()
  for (const d of deliveries) byTarget.set(d.url, [...(byTarget.get(d.url) ?? []), d])
  await Promise.all([...byTarget.values()].map(async queue => {
    for (const d of queue) await post(d)
  }))
}

/** Nach der Antwort ausführen; außerhalb eines Request-Kontexts (Skripte) einfach im Hintergrund. */
function schedule(task: () => Promise<void>) {
  const run = () => task().catch(error => console.error('Fehler bei der Benachrichtigung verknüpfter Tools:', error))
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Meldet den aktuellen Stand dieser Zusagen an die verknüpften Tools ihrer Termine. Ist kein
 * Tool eingerichtet, passiert gar nichts (auch keine Abfrage).
 */
export function notifyLinkedToolsOfRsvps(rsvpIds: (string | null | undefined)[]) {
  const ids = [...new Set(rsvpIds.filter((id): id is string => !!id))]
  if (ids.length === 0 || configuredTools().length === 0) return
  schedule(async () => {
    const rsvps = await prisma.rsvp.findMany({ where: { AND: [{ id: { in: ids } }, HAS_TOOL_LINK] }, select: RSVP_STATE })
    await deliver(rsvps.flatMap(r => deliveriesFor(r, false)))
  })
}

/** Alle Zusagen eines Participants (z.B. nach einer Profil- oder Verifizierungsänderung) - nur künftige Termine. */
export function notifyLinkedToolsOfParticipants(participantIds: string[]) {
  if (participantIds.length === 0 || configuredTools().length === 0) return
  schedule(async () => {
    const rsvps = await prisma.rsvp.findMany({
      where: { AND: [{ participantId: { in: participantIds }, event: { date: { gte: new Date() } } }, HAS_TOOL_LINK] },
      select: RSVP_STATE
    })
    await deliver(rsvps.flatMap(r => deliveriesFor(r, false)))
  })
}

/**
 * Vor dem Löschen aufrufen: liest die betroffenen Zusagen (solange es sie noch gibt), baut die
 * Meldungen "attending false" sofort und verschickt sie nach der Antwort. Filter wie bei
 * prisma.rsvp.findMany - z.B. { participantId } oder { eventId: { in: [...] } }.
 */
export async function notifyLinkedToolsBeforeDelete(where: Prisma.RsvpWhereInput) {
  if (configuredTools().length === 0) return
  const rsvps = await prisma.rsvp.findMany({ where: { AND: [where, HAS_TOOL_LINK] }, select: RSVP_STATE })
  const deliveries = rsvps.flatMap(r => deliveriesFor(r, true))
  if (deliveries.length > 0) schedule(() => deliver(deliveries))
}
