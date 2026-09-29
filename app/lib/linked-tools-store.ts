// app/lib/linked-tools-store.ts
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { TOOL_DEFINITIONS, isToolType, parseToolUrl, resolveToolOrigin, toolLinkOf, type ToolLink, type ToolType } from './linked-tools'

/**
 * Datenbankseite der Verknüpfungen (EventToolLink, siehe app/lib/linked-tools.ts): lesen für
 * Seiten/Mails/Routen und speichern aus den Termin-Formularen.
 */

/** Für include/select an einem Event: `include: { toolLinks: TOOL_LINKS }`. */
export const TOOL_LINKS = { select: { type: true, url: true, remoteEventId: true } } as const

/** Die gültige Verknüpfung eines Termins mit einem Tool, direkt aus der Datenbank (z.B. für Mails). */
export async function findToolLink(eventId: string, type: ToolType): Promise<ToolLink | null> {
  const toolLinks = await prisma.eventToolLink.findMany({ where: { eventId, type }, ...TOOL_LINKS })
  return toolLinkOf({ id: eventId, toolLinks }, type)
}

/** Der gespeicherte Link eines Tools (auch wenn er gerade nicht gilt) - für die Formularfelder. */
export function storedToolUrl(toolLinks: { type: string; url: string }[], type: ToolType): string {
  return toolLinks.find(l => l.type === type)?.url ?? ''
}

export type ToolLinkInput = { type: ToolType; link: ToolLink | null }

/**
 * Liest die Link-Felder aller Tools aus einem Termin-Formular - leer heißt "Verknüpfung
 * entfernen", sonst wird der Link in seine kanonische Form gebracht. Ein Link, der nicht genau
 * diese Form hat oder nicht auf die Adresse des Tools (<PREFIX>_BASE_URL) zeigt, wird abgelehnt
 * statt still gespeichert: sonst ginge der Button ins Leere, und über den Origin könnte man den
 * Server Webhooks an beliebige Adressen schicken lassen.
 *
 * Das Feld eines Tools erscheint nur, wenn dessen Adresse eingerichtet ist - fehlt es, bleibt
 * eine gespeicherte Verknüpfung unverändert (kein Eintrag im Ergebnis), statt bei vorübergehend
 * fehlender Konfiguration still gelöscht zu werden. Wirft bei ungültiger Eingabe, BEVOR etwas
 * gespeichert wurde.
 */
export function readToolLinks(formData: FormData): ToolLinkInput[] {
  const result: ToolLinkInput[] = []
  for (const definition of TOOL_DEFINITIONS) {
    if (!isToolType(definition.type) || !formData.has(definition.formField)) continue
    const input = (formData.get(definition.formField) as string || '').trim()
    if (!input) {
      result.push({ type: definition.type, link: null })
      continue
    }
    const origin = resolveToolOrigin(definition)
    if (!origin) {
      throw new Error(`Die Anbindung an ${definition.label} ist auf diesem Server nicht eingerichtet (${definition.baseUrlEnv}, ${definition.secretEnv}) - bitte das Feld "${definition.linkLabel}" leer lassen.`)
    }
    const link = parseToolUrl(definition, input, origin)
    if (!link) {
      throw new Error(`Ungültiger ${definition.linkLabel}. Erwartet wird der Link aus den ${definition.label}-Einstellungen des Events, also ${origin}/${definition.linkSegment}/<Event-ID>.`)
    }
    result.push({ type: definition.type, link })
  }
  return result
}

/**
 * Was beim Ändern oder Entfernen der Verknüpfung eines Tools zusätzlich wegfällt - Daten, die
 * das bisherige Tool-Event gemeldet hat, gelten für ein anderes (oder keins) nicht mehr.
 */
const ON_RELINK: Record<ToolType, (tx: Prisma.TransactionClient, eventId: string) => Promise<unknown>> = {
  // Plätze aus Seating: geleert, bis das neue Seating-Event seinen Stand meldet (syncedAt wird mit der Zeile zurückgesetzt)
  seating: (tx, eventId) => tx.rsvp.updateMany({ where: { eventId, seatingLabel: { not: null } }, data: { seatingLabel: null } }),
  // Zeitplan meldet nichts zurück - hier gibt es nichts zu leeren
  timeline: async () => {}
}

/** Speichert die gelesenen Verknüpfungen eines Termins. Unveränderte Links bleiben samt syncedAt unberührt. */
export async function saveToolLinks(eventId: string, inputs: ToolLinkInput[]) {
  for (const { type, link } of inputs) {
    await prisma.$transaction(async tx => {
      const where = { eventId_type: { eventId, type } }
      const current = await tx.eventToolLink.findUnique({ where })
      if ((current?.url ?? null) === (link?.url ?? null)) return
      if (!link) {
        await tx.eventToolLink.delete({ where })
      } else {
        await tx.eventToolLink.upsert({
          where,
          create: { eventId, type, url: link.url, remoteEventId: link.remoteEventId },
          update: { url: link.url, remoteEventId: link.remoteEventId, syncedAt: null }
        })
      }
      await ON_RELINK[type](tx, eventId)
    })
  }
}
