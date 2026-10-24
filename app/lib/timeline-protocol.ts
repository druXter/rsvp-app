// app/lib/timeline-protocol.ts
//
// Protokoll im Zeitplan-Rückblick (Idee L7): Der verknüpfte Zeitplan fragt beim Anzeigen des Rückblicks signiert an
// (`protocol-request` an POST /api/timeline/protocol, Secret der Zeitplan-Anbindung TIMELINE_SECRET) und bekommt, was
// der Termin einzeln freigibt (Event.timelinePresence, Event.timelineDecisions): Kommen und Gehen mit Namen und die
// Beschlüsse der verknüpften Sitzung, die rsvp-app dafür beim Abstimmungstool abruft (`assembly-decisions`, dort
// POST /api/assembly/decisions, Secret POLL_VERIFICATION_SECRET). Der Zeitplan zeigt das nur an und speichert nichts.
import { assemblyOf } from './assembly'
import { createSignedMessage, isRecord, verifyEnvelope, type ConfiguredTool, type ToolLink } from './linked-tools'
import { signForPollTool, verifyFromPollTool } from './poll-verification'

const MAX_DECISIONS = 200
const MAX_OPTIONS = 100
const MAX_NAMES = 2000

/** Anfrage des Zeitplans: Signatur, Empfänger und Gültigkeit wie bei allen Nachrichten der Anbindung. */
export function verifyProtocolRequest(token: unknown, tool: ConfiguredTool): { timelineEventId: string; rsvpEventId: string } | null {
  const verified = verifyEnvelope(token, 'protocol-request', { secret: tool.secret, audience: tool.ownOrigin, remoteIdField: tool.definition.remoteIdField })
  return verified ? { timelineEventId: verified.envelope.remoteEventId, rsvpEventId: verified.envelope.rsvpEventId } : null
}

/** Termin-Formular: nur wenn die Felder gezeigt wurden (`protocolShown`), sonst bleibt alles, wie es ist. */
export function readProtocolSettings(formData: FormData): { timelinePresence?: boolean; timelineDecisions?: boolean } {
  if (!formData.has('protocolShown')) return {}
  return { timelinePresence: formData.get('timelinePresence') === 'on', timelineDecisions: formData.get('timelineDecisions') === 'on' }
}

export type ProtocolPresence = { at: string; name: string; change: 'IN' | 'OUT' | 'BACK' }

/** Kommen und Gehen in zeitlicher Reihenfolge; wer schon einmal da war, "kommt wieder" (wie die CSV der Anwesenheit). */
export function protocolPresence(entries: readonly { rsvpId: string; position: number | null; name: string; kind: string; at: Date }[]): ProtocolPresence[] {
  const seen = new Set<string>()
  return [...entries].sort((a, b) => a.at.getTime() - b.at.getTime()).map(e => {
    const key = `${e.rsvpId}:${e.position ?? ''}`
    const again = seen.has(key)
    seen.add(key)
    return { at: e.at.toISOString(), name: e.name, change: e.kind === 'OUT' ? 'OUT' : again ? 'BACK' : 'IN' }
  })
}

export type ProtocolDecision = {
  title: string
  secret: boolean
  openedAt: string
  closedAt: string
  voters: number
  present: number | null
  quorumMet: boolean | null
  options: { label: string; votes: number; names?: string[] }[]
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

/** Prüft einen Beschluss aus dem Abstimmungstool feldweise - weitergegeben wird nur, was hier steht. */
function readDecision(raw: unknown): ProtocolDecision | null {
  if (!isRecord(raw)) return null
  const { title, secret, openedAt, closedAt, voters, present, quorumMet, options } = raw
  if (!isText(title, 500) || typeof secret !== 'boolean' || !isTime(openedAt) || !isTime(closedAt) || !isCount(voters)) return null
  if (present !== null && !isCount(present)) return null
  if (quorumMet !== null && typeof quorumMet !== 'boolean') return null
  if (!Array.isArray(options) || options.length > MAX_OPTIONS) return null
  const read = options.map(o => {
    if (!isRecord(o) || !isText(o.label, 500) || !isCount(o.votes)) return null
    if (o.names === undefined || secret) return { label: o.label, votes: o.votes }
    if (!Array.isArray(o.names) || o.names.length > MAX_NAMES || !o.names.every(n => isText(n, 200))) return null
    return { label: o.label, votes: o.votes, names: o.names as string[] }
  })
  if (read.some(o => o === null)) return null
  return { title, secret, openedAt, closedAt, voters, present: present as number | null, quorumMet: quorumMet as boolean | null, options: read as ProtocolDecision['options'] }
}

export type DecisionsResult = { state: 'ok'; decisions: ProtocolDecision[] } | { state: 'off' } | { state: 'unreachable' }

/** Beschlüsse der verknüpften Sitzung - off ohne Sitzung oder Kopplung, unreachable bei Fehler oder ungültiger Antwort. */
export async function fetchDecisions(event: { id: string; assemblyUrl: string | null }): Promise<DecisionsResult> {
  const assembly = assemblyOf(event)
  const body = assembly && signForPollTool('assembly-decisions', { assemblyId: assembly.assemblyId, eventId: event.id }, { audience: assembly.origin, ttlSeconds: 5 * 60 })
  if (!assembly || !body) return { state: 'off' }
  try {
    const response = await fetch(`${assembly.origin}/api/assembly/decisions`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: AbortSignal.timeout(5000), cache: 'no-store'
    })
    if (!response.ok) return { state: 'unreachable' }
    const payload = verifyFromPollTool(await response.text(), 'assembly-decisions-result')
    if (!payload || payload.assemblyId !== assembly.assemblyId || payload.eventId !== event.id) return { state: 'unreachable' }
    if (!Array.isArray(payload.decisions) || payload.decisions.length > MAX_DECISIONS) return { state: 'unreachable' }
    const decisions = payload.decisions.map(readDecision)
    if (decisions.some(d => d === null)) return { state: 'unreachable' }
    return { state: 'ok', decisions: decisions as ProtocolDecision[] }
  } catch {
    return { state: 'unreachable' }
  }
}

/**
 * Antwort an den Zeitplan (`protocol`), 5 Minuten gültig. presence bzw. decisions sind null, wenn der Termin sie nicht
 * freigibt; decisionsState sagt, ob die Beschlüsse geladen werden konnten.
 */
export function createProtocol(
  tool: ConfiguredTool, link: ToolLink, rsvpEventId: string,
  content: { presence: ProtocolPresence[] | null; decisions: DecisionsResult | null }
): string {
  return createSignedMessage('protocol', {
    aud: link.origin,
    timelineEventId: link.remoteEventId,
    rsvpEventId,
    presence: content.presence,
    decisions: content.decisions?.state === 'ok' ? content.decisions.decisions : null,
    decisionsState: content.decisions ? content.decisions.state : 'off'
  }, tool.secret, { ttlSeconds: 300 })
}
