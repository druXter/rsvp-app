// app/lib/linked-tools.ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verknüpfte Tools ("Anbindungen"): andere, eigenständige Anwendungen der Suite, mit denen ein
 * Termin verknüpft werden kann - Seating (Sitzplätze, app/lib/seating.ts) und das Zeitplan-Tool
 * (Ablauf des Events, app/lib/timeline.ts).
 *
 * Jedes Tool steht einmal in TOOL_DEFINITIONS und hat
 * - eine eigene Adresse (<PREFIX>_BASE_URL): nur Links mit genau diesem Origin werden
 *   angenommen, und nur dorthin gehen Webhooks - sonst könnte jede Creator*in über einen Link
 *   den Server Anfragen an beliebige Adressen schicken lassen (SSRF);
 * - ein EIGENES Secret (<PREFIX>_SECRET): Nachrichten an bzw. von einem Tool werden nur mit
 *   dessen Secret signiert und geprüft, `aud` ist immer der Origin des Empfängers. Zwei Tools
 *   mit demselben Secret (oder einem Tool-Secret, das dem Abstimmungstool gehört) gelten
 *   BEIDE als nicht eingerichtet - sonst ließe sich eine Nachricht der einen Anbindung in der
 *   anderen einspielen;
 * - pro Termin höchstens eine Verknüpfung (Tabelle EventToolLink, eindeutig je Termin und Typ).
 *
 * Nachrichtenformat für alle Tools gleich (entstanden mit Seating, dort app/lib/rsvp/token.ts):
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, Secret des Tools))
 *
 * mit typ, aud, iat/exp (Unix-Sekunden, höchstens eine Stunde), der Event-ID beim Tool (Feldname
 * je Tool, z.B. seatingEventId) und rsvpEventId (= Event.id hier). Welche Arten es gibt und was
 * sie enthalten, legt der Vertrag des jeweiligen Tools fest (Seating: app/lib/seating.ts).
 *
 * Diese Datei ist bewusst frei von Datenbankzugriffen (Unit-Tests); alle Prüfungen geben bei
 * jedem Problem null zurück statt zu werfen - "nicht gültig" ist ein normaler Zustand.
 */

export const MAX_TOKEN_AGE_SECONDS = 60 * 60
const CLOCK_SKEW_SECONDS = 60
const MIN_SECRET_LENGTH = 32
/** Format der ids auf beiden Seiten (cuid) - gilt für Event-IDs hier und bei jedem Tool. */
export const REMOTE_ID = /^[a-z0-9]{10,40}$/

// --- Definitionen ---------------------------------------------------------------------------

export type ToolDefinition = {
  type: string
  /** Name für Meldungen ("Seating") */
  label: string
  /** Name des Links im Termin-Formular ("Sitzplatz-Link") */
  linkLabel: string
  secretEnv: string
  baseUrlEnv: string
  /** Formularfeld im Termin-Formular (für Seating aus Kompatibilität "seatingUrl") */
  formField: string
  /** Ein Link auf ein Event beim Tool hat die Form `<Origin>/<linkSegment>/<Event-ID beim Tool>`. */
  linkSegment: string
  /** Name des Felds mit der Event-ID beim Tool in jeder Nachricht */
  remoteIdField: string
  /** Pfad des Webhooks "rsvp-change" beim Tool */
  webhookPath: string
}

/**
 * Alle Tools, die hier angebunden werden können. Ein neues Tool bekommt hier einen Eintrag - der Typ ToolType wächst damit automatisch mit, und TypeScript verlangt
 * dann überall, wo es pro Typ eine Implementierung braucht (Webhook-Inhalt in
 * app/lib/linked-tools-notify.ts, Aufräumen beim Neu-Verknüpfen in app/lib/linked-tools-store.ts),
 * eine für das neue Tool.
 */
const DEFINITIONS = {
  seating: {
    type: 'seating',
    label: 'Seating',
    linkLabel: 'Sitzplatz-Link',
    secretEnv: 'SEATING_SECRET',
    baseUrlEnv: 'SEATING_BASE_URL',
    formField: 'seatingUrl',
    linkSegment: 'rsvp',
    remoteIdField: 'seatingEventId',
    webhookPath: '/api/rsvp-webhook'
  },
  // Zeitplan (eigenes Repo, dort app/lib/rsvp/token.ts): nur Kennungen und "diese Zusage gilt"
  timeline: {
    type: 'timeline',
    label: 'Zeitplan',
    linkLabel: 'Zeitplan-Link',
    secretEnv: 'TIMELINE_SECRET',
    baseUrlEnv: 'TIMELINE_BASE_URL',
    formField: 'timelineUrl',
    linkSegment: 'rsvp',
    remoteIdField: 'timelineEventId',
    webhookPath: '/api/rsvp-webhook'
  }
} as const satisfies Record<string, ToolDefinition>

export type ToolType = keyof typeof DEFINITIONS
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.values(DEFINITIONS)

export function isToolType(value: unknown): value is ToolType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEFINITIONS, value)
}

export function toolDefinition(type: ToolType): ToolDefinition {
  return DEFINITIONS[type]
}

/**
 * Secrets anderer Kopplungen, die kein Tool-Secret sein dürfen (das Abstimmungstool hat einen
 * eigenen Vertrag, siehe app/lib/poll-verification.ts).
 */
const FOREIGN_SECRET_ENVS = ['POLL_VERIFICATION_SECRET']

// --- Konfiguration --------------------------------------------------------------------------

type Env = Record<string, string | undefined>

/** Origin einer Basis-URL ("https://plaetze.example.de/" -> "https://plaetze.example.de"), null wenn ungültig. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Origin dieser App - Empfänger (aud) der Nachrichten aller Tools. */
export function ownOrigin(env: Env = process.env): string | null {
  return originOf(env.BASE_URL)
}

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

/**
 * Das Secret eines Tools - nur mit mindestens 32 Zeichen und nur, wenn kein anderes Tool und
 * keine andere Kopplung denselben Wert hat. Bei einer Doppelung gelten alle Beteiligten als
 * nicht eingerichtet (jedes sieht das andere), unabhängig von der Reihenfolge.
 */
export function resolveToolSecret(
  definition: ToolDefinition, env: Env = process.env, definitions: readonly ToolDefinition[] = TOOL_DEFINITIONS
): string | null {
  const value = env[definition.secretEnv]
  if (!value || value.length < MIN_SECRET_LENGTH) return null
  const others = [
    ...FOREIGN_SECRET_ENVS,
    ...definitions.filter(d => d.secretEnv !== definition.secretEnv).map(d => d.secretEnv)
  ]
  const clash = others.find(name => env[name] === value)
  if (clash) {
    warnOnce(`${definition.secretEnv}=${clash}`, `[linked-tools] ${definition.secretEnv} hat denselben Wert wie ${clash} - die Anbindung an ${definition.label} ist deshalb aus. Jede Anbindung braucht ihr eigenes Secret.`)
    return null
  }
  return value
}

/** Der einzige Origin, den ein Link auf dieses Tool haben darf (<PREFIX>_BASE_URL). */
export function resolveToolOrigin(definition: ToolDefinition, env: Env = process.env): string | null {
  return originOf(env[definition.baseUrlEnv])
}

/** Ein vollständig eingerichtetes Tool: gültiges eigenes Secret, eigene Adresse, Adresse dieser App. */
export type ConfiguredTool = { definition: ToolDefinition; secret: string; origin: string; ownOrigin: string }

export function resolveConfiguredTool(
  definition: ToolDefinition, env: Env = process.env, definitions: readonly ToolDefinition[] = TOOL_DEFINITIONS
): ConfiguredTool | null {
  const secret = resolveToolSecret(definition, env, definitions)
  const origin = resolveToolOrigin(definition, env)
  const own = ownOrigin(env)
  if (!secret || !origin || !own) return null
  return { definition, secret, origin, ownOrigin: own }
}

export function configuredTool(type: ToolType): ConfiguredTool | null {
  return resolveConfiguredTool(toolDefinition(type))
}

/** Alle eingerichteten Tools - leer, wenn keine Anbindung konfiguriert ist. */
export function configuredTools(): ConfiguredTool[] {
  return TOOL_DEFINITIONS.map(d => resolveConfiguredTool(d)).filter((t): t is ConfiguredTool => t !== null)
}

// --- Zusagen -------------------------------------------------------------------------------

/**
 * Die eine Regel, wann eine Zusage bei einem verknüpften Tool zählt: zugesagt, nicht auf der
 * Warteliste und - bei aktiver Double-Opt-In-Pflicht (effektiver Wert, bei Reihen der der Reihe) -
 * verifiziert. Gilt für alle Tools gleich (Button, Weiterleitung, Webhook-Feld attending).
 */
export function isConfirmedRsvp(
  rsvp: { isAttending: boolean; isOnWaitlist: boolean },
  participant: { isVerified: boolean },
  requireVerification: boolean
): boolean {
  return rsvp.isAttending && !rsvp.isOnWaitlist && (!requireVerification || participant.isVerified)
}

// --- Links ----------------------------------------------------------------------------------

export type ToolLink = { type: string; url: string; origin: string; remoteEventId: string }

/**
 * Zerlegt einen Link auf ein Event beim Tool (`<Origin>/<linkSegment>/<Event-ID>`). null, wenn
 * das Format nicht passt oder der Origin nicht der erlaubte ist. `url` ist die kanonische Form
 * ohne Query/Fragment.
 */
export function parseToolUrl(definition: ToolDefinition, value: string | null | undefined, allowedOrigin: string | null): ToolLink | null {
  if (!value || !allowedOrigin) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.origin !== allowedOrigin || parsed.username || parsed.password) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== definition.linkSegment || !REMOTE_ID.test(segments[1])) return null
  return {
    type: definition.type,
    url: `${parsed.origin}/${definition.linkSegment}/${segments[1]}`,
    origin: parsed.origin,
    remoteEventId: segments[1]
  }
}

/** Eine gespeicherte Verknüpfung (Auszug aus EventToolLink). */
export type StoredToolLink = { type: string; url: string; remoteEventId: string }

/**
 * Prüft eine gespeicherte Verknüpfung bei JEDER Verwendung erneut gegen die aktuelle
 * Konfiguration (Origin, Format, gespeicherte ID) - ein Link, der beim Speichern gültig war,
 * aber nach einer Konfigurationsänderung nicht mehr auf das Tool zeigt, wird nie verwendet.
 */
export function validToolLink(tool: ConfiguredTool, eventId: string, stored: StoredToolLink | undefined | null): ToolLink | null {
  if (!stored || stored.type !== tool.definition.type || !REMOTE_ID.test(eventId)) return null
  const link = parseToolUrl(tool.definition, stored.url, tool.origin)
  if (!link || link.remoteEventId !== stored.remoteEventId) return null
  return link
}

type EventWithLinks = { id: string; toolLinks: StoredToolLink[] }

/** Die Verknüpfung eines Termins mit einem Tool, wenn das Tool eingerichtet ist und der Link gilt. */
export function toolLinkOf(event: EventWithLinks, type: ToolType): ToolLink | null {
  const tool = configuredTool(type)
  return tool ? validToolLink(tool, event.id, event.toolLinks.find(l => l.type === type)) : null
}

/** Alle gültigen Verknüpfungen eines Termins, jeweils mit ihrem Tool (für den Webhook). */
export function linkedToolsOf<T extends ConfiguredTool = ConfiguredTool>(
  event: EventWithLinks, tools: T[] = configuredTools() as T[]
): { tool: T; link: ToolLink }[] {
  const result: { tool: T; link: ToolLink }[] = []
  for (const tool of tools) {
    const link = validToolLink(tool, event.id, event.toolLinks.find(l => l.type === tool.definition.type))
    if (link) result.push({ tool, link })
  }
  return result
}

// --- Format ---------------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function signature(payloadPart: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payloadPart).digest())
}

export function signMessage(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload))
  return `${payloadPart}.${signature(payloadPart, secret)}`
}

/** Signatur prüfen (konstante Laufzeit) und die Nutzlast lesen - ohne inhaltliche Prüfung. */
export function openMessage(token: unknown, secret: string): unknown {
  if (typeof token !== 'string' || token.length > 4_000_000) return null
  const parts = token.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = Buffer.from(signature(parts[0], secret))
  const actual = Buffer.from(parts[1])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    return JSON.parse(fromBase64url(parts[0]).toString('utf8'))
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type Envelope = { typ: string; aud: string; iat: number; exp: number; remoteEventId: string; rsvpEventId: string }

/**
 * Prüft Signatur (mit dem Secret GENAU EINES Tools), Art, Empfänger, Gültigkeit und die beiden
 * Event-IDs einer Nachricht. Gibt den Umschlag und die rohe Nutzlast zurück - den Inhalt je Art
 * prüft der Vertrag des Tools.
 */
export function verifyEnvelope(
  token: unknown, typ: string, options: { secret: string; audience: string; remoteIdField: string; now?: Date }
): { envelope: Envelope; raw: Record<string, unknown> } | null {
  const raw = openMessage(token, options.secret)
  if (!isRecord(raw) || raw.typ !== typ) return null
  const { aud, iat, exp, rsvpEventId } = raw
  const remoteEventId = raw[options.remoteIdField]
  if (typeof aud !== 'string' || aud !== options.audience) return null
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null
  if (typeof remoteEventId !== 'string' || !REMOTE_ID.test(remoteEventId)) return null
  if (typeof rsvpEventId !== 'string' || !REMOTE_ID.test(rsvpEventId)) return null
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const issued = iat as number
  const expires = exp as number
  if (expires <= now || expires - now > MAX_TOKEN_AGE_SECONDS) return null
  if (issued > now + CLOCK_SKEW_SECONDS || issued > expires) return null
  return { envelope: { typ, aud, iat: issued, exp: expires, remoteEventId, rsvpEventId }, raw }
}

/**
 * Signiert eine Nachricht: `{ typ, ...fields, iat, exp }` in genau dieser Schlüsselreihenfolge
 * (Standard 10 Minuten, höchstens eine Stunde gültig).
 */
export function createSignedMessage(
  typ: string, fields: object, secret: string, options: { now?: Date; ttlSeconds?: number } = {}
): string {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const ttl = Math.min(options.ttlSeconds ?? 600, MAX_TOKEN_AGE_SECONDS)
  return signMessage({ typ, ...fields, iat, exp: iat + ttl }, secret)
}

// --- HTTP -----------------------------------------------------------------------------------

/**
 * Liest den Body höchstens bis `max` Bytes - null, wenn er größer ist. Content-Length allein
 * reicht nicht (fehlt bei chunked Übertragung oder lügt), deshalb wird der Stream mitgezählt.
 */
export async function readLimitedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks).toString('utf8')
}
