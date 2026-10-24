// app/lib/seating.ts
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

import {
  REMOTE_ID, configuredTool, createSignedMessage, isConfirmedRsvp, isRecord, parseToolUrl, resolveToolOrigin, resolveToolSecret, toolDefinition, toolLinkOf, verifyEnvelope, type ConfiguredTool, type StoredToolLink, type ToolLink
} from './linked-tools'

// Allgemeiner Teil (Format, Signatur, Konfiguration, Links) steht in app/lib/linked-tools.ts und
// gilt für alle verknüpften Tools - hier nur, was Seating betrifft. Die Exporte unten bleiben
// unter ihren bisherigen Namen erhalten (Vertrag und Tests beziehen sich darauf).
export { MAX_TOKEN_AGE_SECONDS, openMessage, originOf, ownOrigin, signMessage } from './linked-tools'

/** Format der ids auf beiden Seiten (cuid) - identisch zur Prüfung in Seating. */
export const SEATING_ID = REMOTE_ID
/** Obergrenzen wie in Seatings Schema: sonst lehnt Seating die ganze Nachricht ab. */
const MAX_NAME = 100
const MAX_EMAIL = 254
const MAX_LABEL = 500
const MAX_ENTRIES = 5000

const SEATING = toolDefinition('seating')

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
/** Wo eine Person sitzt (index wie in guestOf: 0 = name, 1.. = companions), soweit Seating es weiß. */
export type SeatingPersonPlace = { index: number; table: string | null; seat: string | null }
export type SeatingPlacement = { rsvpId: string; label: string; persons?: SeatingPersonPlace[] }

// --- Konfiguration --------------------------------------------------------------------------

/**
 * Gemeinsames Secret mit Seating (hier SEATING_SECRET, dort RSVP_SEATING_SECRET). Gilt nur mit
 * mindestens 32 Zeichen und nur, wenn es weder das Secret des Abstimmungstools noch das eines
 * anderen verknüpften Tools ist (resolveToolSecret). Ohne gültiges Secret ist die Anbindung aus.
 */
export function seatingSecret(): string | null {
  return resolveToolSecret(SEATING)
}

/**
 * Der einzige Seating-Origin, den ein Sitzplatz-Link haben darf (SEATING_BASE_URL). Ohne diese
 * Vorgabe könnte jede Creator*in über den Link den Server Webhooks an beliebige Adressen
 * schicken lassen (auch ins interne Netz) - gleiche Idee wie ABSTIMMUNGSTOOL_BASE_URL.
 */
export function allowedSeatingOrigin(): string | null {
  return resolveToolOrigin(SEATING)
}

export function seatingTool(): ConfiguredTool | null {
  return configuredTool('seating')
}

export function seatingConfigured(): boolean {
  return seatingTool() !== null
}

export type SeatingLink = { url: string; origin: string; seatingEventId: string }

function asSeatingLink(link: ToolLink | null): SeatingLink | null {
  return link ? { url: link.url, origin: link.origin, seatingEventId: link.remoteEventId } : null
}

/**
 * Zerlegt einen Sitzplatz-Link (`<Seating-Origin>/rsvp/<seatingEventId>`, so zeigt ihn Seating
 * in den Event-Einstellungen an). null, wenn das Format nicht passt oder der Origin nicht
 * SEATING_BASE_URL ist. `url` ist die kanonische Form ohne Query/Fragment.
 */
export function parseSeatingUrl(value: string | null | undefined, allowedOrigin = allowedSeatingOrigin()): SeatingLink | null {
  return asSeatingLink(parseToolUrl(SEATING, value, allowedOrigin))
}

/** Der Sitzplatz-Link eines Events, wenn die Anbindung eingerichtet ist und der Link gilt. */
export function seatingLinkOf(event: { id: string; toolLinks: StoredToolLink[] }): SeatingLink | null {
  return asSeatingLink(toolLinkOf(event, 'seating'))
}

// --- Inhalte --------------------------------------------------------------------------------

/** Wie Seatings cleanName: Steuerzeichen raus, Leerraum zusammenfassen. */
export function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Die Angaben einer Zusage, wie sie an Seating gehen. Name nie leer (Seating verlangt einen), E-Mail nur, wenn
 * sie in Seatings Grenze passt. Mit Personenliste (app/lib/persons.ts) ist `name` die erste zusagende Person und
 * `companions` sind die weiteren - ohne Kleinkinder, die keinen eigenen Platz brauchen, Begleitungen ohne Namen
 * als null. Ohne Personenliste ist die Antwort genau eine Person.
 */
export function guestOf(
  rsvp: { id: string; persons?: readonly { position: number; name: string | null; ageGroup: string; isAttending: boolean }[] | null },
  participant: { name: string; email: string | null }
): SeatingGuest {
  const email = participant.email?.trim() || null
  const seated = [...(rsvp.persons ?? [])]
    .sort((a, b) => a.position - b.position)
    .filter(p => p.isAttending && p.ageGroup !== 'INFANT')
  const name = (value: string | null | undefined) => cleanName(value || '').slice(0, MAX_NAME) || null
  return {
    rsvpId: rsvp.id,
    name: name(seated[0]?.name) || name(participant.name) || 'Gast',
    email: email && email.length <= MAX_EMAIL ? email : null,
    companions: seated.slice(1).map(p => name(p.name))
  }
}

/**
 * Wer bei Seating als zugesagt gilt - dieselbe Regel wie für alle verknüpften Tools
 * (isConfirmedRsvp in app/lib/linked-tools.ts): zugesagt, nicht Warteliste, ggf. verifiziert.
 * Dazu "Sitzplatzwahl erst nach Zahlung" (Event.seatingRequiresPayment, docs/KONZEPT-TICKETS.md):
 * Eine Zusage mit offenem Betrag zählt dann noch nicht. `requiresPayment` ist absichtlich Pflicht,
 * damit keine Aufrufstelle den Schalter übersieht.
 */
export function isSeatingConfirmed(
  rsvp: { isAttending: boolean; isOnWaitlist: boolean; amountCents: number | null; paidAt: Date | null },
  participant: { isVerified: boolean },
  requireVerification: boolean,
  requiresPayment: boolean
): boolean {
  return isConfirmedRsvp(rsvp, participant, requireVerification) && !(requiresPayment && !!rsvp.amountCents && !rsvp.paidAt)
}

// --- Prüfen und Ausstellen -------------------------------------------------------------------

type Content<T extends SeatingMessageType> =
  T extends 'placements' ? { placements: SeatingPlacement[] }
  : T extends 'guest-list' ? { guests: SeatingGuest[] }
  : T extends 'seat-link' ? SeatingGuest
  : T extends 'rsvp-change' ? SeatingGuest & { attending: boolean }
  : Record<never, never>

export type SeatingMessage<T extends SeatingMessageType> = SeatingEnvelope & { typ: T } & Content<T>

const PERSON_KEY = /^(guest|companion-(\d{1,2}))$/
const MAX_PLACE = 200

/** Tisch/Platz pro Person (Seating: rules.ts personPlaces) - "guest" ist Index 0, "companion-N" Index N. */
function readPersonPlaces(value: unknown): SeatingPersonPlace[] | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const result: SeatingPersonPlace[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string') return null
    const key = entry.key.match(PERSON_KEY)
    if (!key) return null
    const place = (v: unknown) => (v === null ? null : typeof v === 'string' && v.length <= MAX_PLACE ? cleanName(v) || null : undefined)
    const table = place(entry.table)
    const seat = place(entry.seat)
    if (table === undefined || seat === undefined) return null
    result.push({ index: key[2] ? Number(key[2]) : 0, table, seat })
  }
  return result
}

function readPlacements(value: unknown): SeatingPlacement[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null
  const result: SeatingPlacement[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (typeof entry.rsvpId !== 'string' || !SEATING_ID.test(entry.rsvpId)) return null
    if (typeof entry.label !== 'string' || entry.label.length > MAX_LABEL) return null
    // persons ist optional (ältere Seating-Versionen schicken es nicht), aber wenn vorhanden, dann gültig
    const persons = entry.persons === undefined ? undefined : readPersonPlaces(entry.persons)
    if (persons === null) return null
    result.push({ rsvpId: entry.rsvpId, label: cleanName(entry.label), ...(persons ? { persons } : {}) })
  }
  return result
}

/**
 * Tisch und Platz jeder Person einer Antwort aus Rsvp.seatingPersons - in der Reihenfolge von personsOf, für die
 * Küchenliste pro Tisch. Seating kennt nur Personen mit Platz (guestOf: zusagend, ohne Kleinkinder); Kleinkinder
 * sitzen am Tisch der ersten Person der Antwort. Unbekannt: null.
 */
export function placesOfPersons(
  persons: readonly { isAttending: boolean; ageGroup: string }[],
  stored: string | null
): { table: string | null; seat: string | null }[] {
  let places: SeatingPersonPlace[] = []
  try {
    const parsed = stored ? JSON.parse(stored) : []
    if (Array.isArray(parsed)) places = parsed.filter((p): p is SeatingPersonPlace => isRecord(p) && typeof p.index === 'number')
  } catch {
    places = []
  }
  const byIndex = new Map(places.map(p => [p.index, p]))
  let seated = 0
  const result = persons.map(p => {
    if (!p.isAttending || p.ageGroup === 'INFANT') return null
    const place = byIndex.get(seated++)
    return { table: place?.table ?? null, seat: place?.seat ?? null }
  })
  const firstTable = result.find(r => r?.table)?.table ?? null
  return result.map((r, i) => r ?? { table: persons[i].isAttending ? firstTable : null, seat: null })
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
  const verified = verifyEnvelope(token, type, { ...options, remoteIdField: SEATING.remoteIdField })
  if (!verified) return null
  const { raw, envelope: { aud, iat, exp, remoteEventId, rsvpEventId } } = verified
  const envelope = { typ: type, aud, iat, exp, seatingEventId: remoteEventId, rsvpEventId }

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
  return createSignedMessage(type, content, secret, options)
}

/**
 * Inhalt des Webhooks "rsvp-change" an Seating (verschickt von app/lib/linked-tools-notify.ts):
 * die Angaben der Zusage und ob sie bei Seating zählt - nach dem Löschen immer attending false.
 */
export function seatingRsvpChange(input: {
  link: ToolLink
  secret: string
  rsvpEventId: string
  rsvp: { id: string; isAttending: boolean; isOnWaitlist: boolean; persons: { position: number; name: string | null; ageGroup: string; isAttending: boolean }[]; amountCents: number | null; paidAt: Date | null }
  participant: { name: string; email: string | null; isVerified: boolean }
  requireVerification: boolean
  seatingRequiresPayment: boolean
  deleted: boolean
}): string {
  const attending = !input.deleted && isSeatingConfirmed(input.rsvp, input.participant, input.requireVerification, input.seatingRequiresPayment)
  return createMessage('rsvp-change', {
    aud: input.link.origin,
    seatingEventId: input.link.remoteEventId,
    rsvpEventId: input.rsvpEventId,
    ...guestOf(input.rsvp, input.participant),
    attending
  }, input.secret)
}
