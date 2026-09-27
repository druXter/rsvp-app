// app/lib/seating.ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Vertrag mit Seating (Sitzplatz-Tool der Suite, eigenes Repo und Deployment - dort
 * app/lib/rsvp/token.ts und README "Anbindung an rsvp-app"). Format wie bei der Kopplung mit
 * dem Abstimmungstool, aber mit EIGENEM Secret:
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, SEATING_SECRET))
 *
 * Jede Nachricht trägt:
 * - typ: die Art (seat-link, rsvp-change, guest-list-request, guest-list, placements). Beide
 *   Richtungen teilen sich ein Secret - ohne typ ließe sich eine Nachricht als eine andere ausgeben.
 * - aud: der Origin des Empfängers (Seating: Origin der seatingUrl, rsvp-app: Origin von BASE_URL).
 * - iat/exp: Unix-Sekunden, angenommen wird höchstens eine Stunde Gültigkeit.
 * - seatingEventId und rsvpEventId (= Event.id hier): die Verknüpfung, die BEIDE Seiten
 *   eingetragen haben müssen.
 *
 * Identität eines Gasts ist die Zusage (Rsvp.id), nie die E-Mail - die ist hier optional.
 * Diese Datei ist bewusst frei von Datenbankzugriffen (Unit-Tests); alle Prüfungen geben bei
 * jedem Problem null zurück statt zu werfen - "nicht gültig" ist ein normaler Zustand.
 */

export const MAX_TOKEN_AGE_SECONDS = 60 * 60
const CLOCK_SKEW_SECONDS = 60
const MIN_SECRET_LENGTH = 32
/** Format der ids auf beiden Seiten (cuid) - identisch zur Prüfung in Seating. */
export const SEATING_ID = /^[a-z0-9]{10,40}$/
/** Obergrenzen wie in Seatings Schema: sonst lehnt Seating die ganze Nachricht ab. */
const MAX_NAME = 100
const MAX_EMAIL = 254
const MAX_LABEL = 500
const MAX_ENTRIES = 5000

export type SeatingMessageType = 'seat-link' | 'rsvp-change' | 'guest-list-request' | 'guest-list' | 'placements'

export type SeatingEnvelope = {
  typ: SeatingMessageType
  aud: string
  iat: number
  exp: number
  seatingEventId: string
  rsvpEventId: string
}

/** Eine Person mit Zusage, wie Seating sie erwartet (Link zur Platzwahl, Änderung, Gästeliste). */
export type SeatingGuest = { rsvpId: string; name: string; email: string | null; companions: (string | null)[] }
export type SeatingPlacement = { rsvpId: string; label: string }

// --- Konfiguration --------------------------------------------------------------------------

/**
 * Gemeinsames Secret mit Seating (dort RSVP_SEATING_SECRET). Gilt nur mit mindestens 32 Zeichen
 * und nur, wenn es NICHT das Secret des Abstimmungstools ist - sonst ließe sich eine Nachricht
 * der einen Kopplung in der anderen einspielen. Ohne gültiges Secret ist die Anbindung aus.
 */
export function seatingSecret(): string | null {
  const value = process.env.SEATING_SECRET
  if (!value || value.length < MIN_SECRET_LENGTH) return null
  if (value === process.env.POLL_VERIFICATION_SECRET) return null
  return value
}

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

/**
 * Der einzige Seating-Origin, den ein Sitzplatz-Link haben darf (SEATING_BASE_URL). Ohne diese
 * Vorgabe könnte jede Creator*in über die seatingUrl den Server Webhooks an beliebige Adressen
 * schicken lassen (auch ins interne Netz) - gleiche Idee wie ABSTIMMUNGSTOOL_BASE_URL.
 */
export function allowedSeatingOrigin(): string | null {
  return originOf(process.env.SEATING_BASE_URL)
}

/** Origin dieser App - Empfänger (aud) der Nachrichten von Seating. */
export function ownOrigin(): string | null {
  return originOf(process.env.BASE_URL)
}

export function seatingConfigured(): boolean {
  return seatingSecret() !== null && allowedSeatingOrigin() !== null && ownOrigin() !== null
}

export type SeatingLink = { url: string; origin: string; seatingEventId: string }

/**
 * Zerlegt einen Sitzplatz-Link (`<Seating-Origin>/rsvp/<seatingEventId>`, so zeigt ihn Seating
 * in den Event-Einstellungen an). null, wenn das Format nicht passt oder der Origin nicht
 * SEATING_BASE_URL ist. `url` ist die kanonische Form ohne Query/Fragment.
 */
export function parseSeatingUrl(value: string | null | undefined, allowedOrigin = allowedSeatingOrigin()): SeatingLink | null {
  if (!value || !allowedOrigin) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.origin !== allowedOrigin || parsed.username || parsed.password) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== 'rsvp' || !SEATING_ID.test(segments[1])) return null
  return { url: `${parsed.origin}/rsvp/${segments[1]}`, origin: parsed.origin, seatingEventId: segments[1] }
}

/** Der Sitzplatz-Link eines Events, wenn die Anbindung eingerichtet ist und der Link gilt. */
export function seatingLinkOf(event: { id: string; seatingUrl: string | null }): SeatingLink | null {
  if (!seatingSecret() || !ownOrigin() || !SEATING_ID.test(event.id)) return null
  return parseSeatingUrl(event.seatingUrl)
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

// --- Inhalte --------------------------------------------------------------------------------

/** Wie Seatings cleanName: Steuerzeichen raus, Leerraum zusammenfassen. */
export function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Die Angaben einer Zusage, wie sie an Seating gehen. Name nie leer (Seating verlangt einen),
 * E-Mail nur, wenn sie in Seatings Grenze passt, Begleitungen heute höchstens eine
 * (plusOne/plusOneName) - ohne Namen als null.
 */
export function guestOf(
  rsvp: { id: string; plusOne: boolean; plusOneName: string | null },
  participant: { name: string; email: string | null }
): SeatingGuest {
  const email = participant.email?.trim() || null
  return {
    rsvpId: rsvp.id,
    name: cleanName(participant.name || '').slice(0, MAX_NAME) || 'Gast',
    email: email && email.length <= MAX_EMAIL ? email : null,
    companions: rsvp.plusOne ? [cleanName(rsvp.plusOneName || '').slice(0, MAX_NAME) || null] : []
  }
}

/**
 * Die eine Regel, wer bei Seating als zugesagt gilt: zugesagt, nicht auf der Warteliste und - bei
 * aktiver Double-Opt-In-Pflicht (effektiver Wert, bei Reihen der der Reihe) - verifiziert.
 */
export function isSeatingConfirmed(
  rsvp: { isAttending: boolean; isOnWaitlist: boolean },
  participant: { isVerified: boolean },
  requireVerification: boolean
): boolean {
  return rsvp.isAttending && !rsvp.isOnWaitlist && (!requireVerification || participant.isVerified)
}

// --- Prüfen und Ausstellen -------------------------------------------------------------------

type Content<T extends SeatingMessageType> =
  T extends 'placements' ? { placements: SeatingPlacement[] }
  : T extends 'guest-list' ? { guests: SeatingGuest[] }
  : T extends 'seat-link' ? SeatingGuest
  : T extends 'rsvp-change' ? SeatingGuest & { attending: boolean }
  : Record<never, never>

export type SeatingMessage<T extends SeatingMessageType> = SeatingEnvelope & { typ: T } & Content<T>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPlacements(value: unknown): SeatingPlacement[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null
  const result: SeatingPlacement[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (typeof entry.rsvpId !== 'string' || !SEATING_ID.test(entry.rsvpId)) return null
    if (typeof entry.label !== 'string' || entry.label.length > MAX_LABEL) return null
    result.push({ rsvpId: entry.rsvpId, label: cleanName(entry.label) })
  }
  return result
}

function readGuest(value: Record<string, unknown>): SeatingGuest | null {
  if (typeof value.rsvpId !== 'string' || !SEATING_ID.test(value.rsvpId)) return null
  if (typeof value.name !== 'string' || value.name.length > 500) return null
  if (value.email !== null && (typeof value.email !== 'string' || value.email.length > MAX_EMAIL)) return null
  if (!Array.isArray(value.companions) || value.companions.length > 49) return null
  if (!value.companions.every(c => c === null || (typeof c === 'string' && c.length <= 500))) return null
  return { rsvpId: value.rsvpId, name: cleanName(value.name), email: value.email, companions: value.companions as (string | null)[] }
}

/**
 * Prüft Signatur, Art, Empfänger, Gültigkeit und Inhalt einer Nachricht - oder null. Eingehend
 * kommen hier nur guest-list-request und placements an; die übrigen Arten prüft diese Funktion
 * mit, damit die Tests die ausgehenden Nachrichten gegen denselben Maßstab halten können.
 */
export function verifyMessage<T extends SeatingMessageType>(
  token: unknown, type: T, options: { secret: string; audience: string; now?: Date }
): SeatingMessage<T> | null {
  const raw = openMessage(token, options.secret)
  if (!isRecord(raw) || raw.typ !== type) return null
  const { aud, iat, exp, seatingEventId, rsvpEventId } = raw
  if (typeof aud !== 'string' || aud !== options.audience) return null
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null
  if (typeof seatingEventId !== 'string' || !SEATING_ID.test(seatingEventId)) return null
  if (typeof rsvpEventId !== 'string' || !SEATING_ID.test(rsvpEventId)) return null
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const issued = iat as number
  const expires = exp as number
  if (expires <= now || expires - now > MAX_TOKEN_AGE_SECONDS) return null
  if (issued > now + CLOCK_SKEW_SECONDS || issued > expires) return null
  const envelope = { typ: type, aud, iat: issued, exp: expires, seatingEventId, rsvpEventId }

  let content: object | null
  switch (type) {
    case 'guest-list-request':
      content = {}
      break
    case 'placements': {
      const placements = readPlacements(raw.placements)
      content = placements ? { placements } : null
      break
    }
    case 'guest-list': {
      if (!Array.isArray(raw.guests) || raw.guests.length > MAX_ENTRIES) return null
      const guests = raw.guests.map(g => (isRecord(g) ? readGuest(g) : null))
      content = guests.every(g => g !== null) ? { guests } : null
      break
    }
    case 'seat-link':
      content = readGuest(raw)
      break
    case 'rsvp-change': {
      const guest = readGuest(raw)
      content = guest && typeof raw.attending === 'boolean' ? { ...guest, attending: raw.attending } : null
      break
    }
    default:
      content = null
  }
  return content ? ({ ...envelope, ...content } as unknown as SeatingMessage<T>) : null
}

/** Signiert eine Nachricht mit iat/exp (Standard 10 Minuten, höchstens eine Stunde gültig). */
export function createMessage<T extends SeatingMessageType>(
  type: T,
  content: Omit<SeatingMessage<T>, 'typ' | 'iat' | 'exp'>,
  secret: string,
  options: { now?: Date; ttlSeconds?: number } = {}
): string {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const ttl = Math.min(options.ttlSeconds ?? 600, MAX_TOKEN_AGE_SECONDS)
  return signMessage({ typ: type, ...content, iat, exp: iat + ttl }, secret)
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
