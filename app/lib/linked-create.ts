// app/lib/linked-create.ts
import {
  LINKED_CREATE, LINKED_CREATE_PATH, LINKED_CREATE_STATUS, readLinkedCreateResult, signLinkedCreate,
  type LinkedCreateMessage, type LinkedCreateResult
} from 'suite-kit'
import { prisma } from './prisma'
import { configuredTool, parseToolUrl, type ConfiguredTool, type ToolType } from './linked-tools'
import { saveToolLinks } from './linked-tools-store'

/**
 * „Einmal anlegen, überall verknüpfen“ (Idee Q1, Vertrag in suite-kit src/linked-create.ts): Beim Termin unter
 * „Verknüpfungen“ legt ein Knopf das passende Event im Zeitplan, in Schichten bzw. in Wichteln an - als Entwurf mit Titel und
 * Datum, dort gleich mit diesem Termin verknüpft - und trägt hier den Link ein. Seating (Raumplan, Modus, Ende) bleibt
 * bei der Verknüpfung von Hand.
 *
 * Das Event gehört dem Konto im Tool, das mit dem eigenen Konto über den Konten-Verbund verknüpft ist; ohne das
 * antwortet das Tool `no-account` mit einem Anmelde-Link. Signiert mit dem Secret der jeweiligen Anbindung, Antworten
 * nur mit Links auf den Origin des Tools (readLinkedCreateResult).
 */

export const CREATABLE_TOOLS = ['timeline', 'shifts', 'wichteln'] as const satisfies readonly ToolType[]
export type CreatableTool = (typeof CREATABLE_TOOLS)[number]

export function isCreatableTool(value: unknown): value is CreatableTool {
  return typeof value === 'string' && (CREATABLE_TOOLS as readonly string[]).includes(value)
}

async function send(tool: ConfiguredTool, message: LinkedCreateMessage): Promise<LinkedCreateResult | null> {
  try {
    const response = await fetch(`${tool.origin}${LINKED_CREATE_PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: signLinkedCreate(message, tool.origin, tool.secret),
      redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store'
    })
    if (!response.ok) {
      console.error(`[linked-create] ${tool.definition.label} antwortet ${response.status}`)
      return null
    }
    return readLinkedCreateResult(await response.json(), tool.origin)
  } catch (error) {
    console.error(`[linked-create] ${tool.definition.label} nicht erreichbar:`, error)
    return null
  }
}

async function requestFor(tool: ConfiguredTool, eventId: string, userId: string) {
  // Meldet sich das Konto hier über das Tool an, kennt das Tool es unter dieser Kennung
  const identity = await prisma.externalIdentity.findFirst({ where: { userId, issuer: tool.origin }, select: { subject: true } })
  return { rsvpEventId: eventId, rsvpUserId: userId, toolUserId: identity?.subject ?? null }
}

/** Kann das Konto das Event beim Tool anlegen? null = Tool nicht eingerichtet oder nicht erreichbar. */
export async function linkedCreateStatus(type: CreatableTool, eventId: string, userId: string): Promise<LinkedCreateResult | null> {
  const tool = configuredTool(type)
  if (!tool) return null
  return send(tool, { kind: LINKED_CREATE_STATUS, request: await requestFor(tool, eventId, userId) })
}

/**
 * Legt das Event beim Tool an (oder übernimmt ein dort schon verknüpftes) und trägt den Link hier ein. null = Tool
 * nicht eingerichtet, nicht erreichbar oder Antwort unbrauchbar.
 */
export async function createLinkedEvent(
  type: CreatableTool, event: { id: string; title: string; date: Date }, userId: string
): Promise<LinkedCreateResult | null> {
  const tool = configuredTool(type)
  if (!tool) return null
  const result = await send(tool, { kind: LINKED_CREATE, request: await requestFor(tool, event.id, userId), title: event.title, startsAt: event.date })
  if (result?.status !== 'created' && result?.status !== 'linked') return result
  const link = parseToolUrl(tool.definition, result.linkUrl, tool.origin)
  if (!link || link.remoteEventId !== result.eventId) return null
  await saveToolLinks(event.id, [{ type, link }])
  return result
}
