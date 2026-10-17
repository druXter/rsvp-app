// app/lib/assembly.ts
//
// Sitzung im Abstimmungstool (Idee L7, Konzept: abstimmungstool docs/KONZEPT-SITZUNG.md): Ein Termin verlinkt eine
// Sitzung (`Event.assemblyUrl` = `<Abstimmungstool>/sitzung/<id>`). Gäste mit einer Zusage, die zählt, treten über
// /api/assembly-link/[eventId] bei (Nachweis `assembly-access` mit Pseudonym und Namen); das Abstimmungstool fragt die
// Anwesenheit über POST /api/assembly/roster ab (`assembly-roster`, Antwort `assembly-roster-result`). Die
// Sitzungsleitung holt sich dort die Liste mit Namen (`assembly-attendance`, /api/assembly/attendance) und checkt ein
// und aus (`assembly-presence`, /api/assembly/presence) - ebenso Mitglieder sich selbst, wenn die Sitzung das erlaubt.
// Gegenstück dort:
// app/lib/assembly-coupling.ts. Gleiches Format und Secret wie die übrige Kopplung (POLL_VERIFICATION_SECRET).
import { createHmac } from 'node:crypto'
import { InputError } from './input-error'
import { isConfirmedRsvp } from './linked-tools'
import { isPresent } from './checkin'
import { sign, verifySignedPayload } from './poll-verification'

/** So lange gilt ein Beitritts-Nachweis - er wird bei jedem Klick frisch ausgestellt. */
const ACCESS_TTL_SECONDS = 15 * 60
const MESSAGE_TTL_SECONDS = 5 * 60
const PATH = /^\/sitzung\/([A-Za-z0-9_-]{1,100})\/?$/
const ID = /^[A-Za-z0-9_-]{1,100}$/

function secret(): string | null {
  return process.env.POLL_VERIFICATION_SECRET || null
}

/** Origin des Abstimmungstools, wenn die Kopplung eingerichtet ist (Adresse und Secret) - sonst kein Feld, keine Sitzung. */
export function assemblyOrigin(): string | null {
  const url = process.env.ABSTIMMUNGSTOOL_BASE_URL
  if (!url || !secret()) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function assemblyIdOf(url: URL, origin: string): string | null {
  return url.origin === origin ? url.pathname.match(PATH)?.[1] ?? null : null
}

/** Link aus dem Termin-Formular: leer = keine Sitzung, sonst genau `<ABSTIMMUNGSTOOL_BASE_URL>/sitzung/<id>`. */
export function parseAssemblyUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const origin = assemblyOrigin()
  if (!origin) throw new InputError('Sitzung: Das Abstimmungstool ist hier nicht eingerichtet.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InputError('Sitzung: Ungültiger Link.')
  }
  const id = assemblyIdOf(url, origin)
  if (!id) throw new InputError(`Sitzung: Erwartet wird der Link einer Sitzung aus dem Abstimmungstool, z. B. ${origin}/sitzung/…`)
  return new URL(`/sitzung/${id}`, origin).toString()
}

/** Die Sitzung eines Termins - bei jeder Verwendung gegen die aktuelle Einrichtung geprüft. */
export function assemblyOf(event: { assemblyUrl: string | null }): { assemblyId: string; origin: string } | null {
  const origin = assemblyOrigin()
  if (!event.assemblyUrl || !origin) return null
  try {
    const id = assemblyIdOf(new URL(event.assemblyUrl), origin)
    return id ? { assemblyId: id, origin } : null
  } catch {
    return null
  }
}

/** Zeigt die Event-Seite "Zur Sitzung"? Sitzung verknüpft und eine Zusage, die zählt (die Route prüft selbst noch einmal). */
export function assemblyLinkVisible(
  event: { assemblyUrl: string | null },
  rsvp: { isAttending: boolean; isOnWaitlist: boolean } | null,
  participant: { isVerified: boolean } | null,
  requireVerification: boolean
): boolean {
  return !!rsvp && !!participant && !!assemblyOf(event) && isConfirmedRsvp(rsvp, participant, requireVerification)
}

/** Seite und Mail verlinken nur hierher - nie die Sitzung selbst (dort tritt man nur mit Nachweis bei). */
export function assemblyRoute(eventId: string, editToken?: string | null): string {
  return `/api/assembly-link/${eventId}${editToken ? `?token=${encodeURIComponent(editToken)}` : ''}`
}

/**
 * Pseudonym einer Zusage für genau eine Sitzung (wie beim Feedback-Fragebogen): das Abstimmungstool erkennt daran
 * dasselbe Mitglied, erfährt aber weder E-Mail noch Rsvp-ID, und verschiedene Sitzungen lassen sich nicht verknüpfen.
 */
export function assemblySubject(assemblyId: string, rsvpId: string, key: string): string {
  return createHmac('sha256', key).update(`assembly-sub\u0000${assemblyId}\u0000${rsvpId}`).digest('base64url')
}

/** Beitritts-Nachweis: Sitzung, Termin, Pseudonym und Name der Zusage, 15 Minuten gültig. null ohne Secret. */
export function signAssemblyAccess(assemblyId: string, eventId: string, rsvpId: string, name: string, now = new Date()): string | null {
  const key = secret()
  if (!key) return null
  const exp = Math.floor(now.getTime() / 1000) + ACCESS_TTL_SECONDS
  return sign({ typ: 'assembly-access', assemblyId, eventId, sub: assemblySubject(assemblyId, rsvpId, key), name: name.trim().slice(0, 100), exp }, key)
}

function verifyAssemblyQuery(token: string | null, typ: string): { assemblyId: string; eventId: string; payload: Record<string, unknown> } | null {
  const payload = verifySignedPayload(token)
  if (!payload || payload.typ !== typ) return null
  const { assemblyId, eventId } = payload
  if (typeof assemblyId !== 'string' || !ID.test(assemblyId) || typeof eventId !== 'string' || !ID.test(eventId)) return null
  return { assemblyId, eventId, payload }
}

/** Anfrage des Abstimmungstools nach der Anwesenheit: Sitzung und Termin, sonst null. */
export function verifyRosterRequest(token: string | null): { assemblyId: string; eventId: string } | null {
  const query = verifyAssemblyQuery(token, 'assembly-roster')
  return query && { assemblyId: query.assemblyId, eventId: query.eventId }
}

/** Anfrage der Sitzungsleitung nach der Anwesenheitsliste mit Namen (`assembly-attendance`). */
export function verifyAttendanceRequest(token: string | null): { assemblyId: string; eventId: string } | null {
  const query = verifyAssemblyQuery(token, 'assembly-attendance')
  return query && { assemblyId: query.assemblyId, eventId: query.eventId }
}

const SUBJECT = /^[A-Za-z0-9_-]{16,128}$/

/**
 * Ein- oder Auschecken aus dem Abstimmungstool (`assembly-presence`): durch die Sitzungsleitung oder - wenn die Sitzung
 * es erlaubt - durch das Mitglied selbst. `present` ist der Zielzustand (nie "umschalten"), damit ein doppelt
 * abgeschickter Klick nichts kaputt macht.
 */
export function verifyPresenceChange(token: string | null): { assemblyId: string; eventId: string; sub: string; present: boolean } | null {
  const query = verifyAssemblyQuery(token, 'assembly-presence')
  if (!query) return null
  const { sub, present } = query.payload
  if (typeof sub !== 'string' || !SUBJECT.test(sub) || typeof present !== 'boolean') return null
  return { assemblyId: query.assemblyId, eventId: query.eventId, sub, present }
}

/** Die Zusage, die zum Pseudonym gehört (nur unter den übergebenen) - oder null. */
export function rsvpOfSubject<T extends { id: string }>(assemblyId: string, rsvps: readonly T[], sub: string): T | null {
  const key = secret()
  if (!key) return null
  return rsvps.find(r => assemblySubject(assemblyId, r.id, key) === sub) ?? null
}

type RosterRsvp = { id: string; isAttending: boolean; isOnWaitlist: boolean; hasAttended: boolean; leftAt: Date | null; participant: { isVerified: boolean } }

/**
 * Antwort auf die Anfrage: Pseudonyme der Zusagen, die zählen und gerade da sind (eingecheckt und - mit Kommen und
 * Gehen - nicht gegangen), Zahl der Zusagen, die zählen, und ob der Termin QR-Einlass hat. Signiert. null ohne Secret.
 */
export function signRosterResult(
  assemblyId: string,
  event: { id: string; enableCheckin: boolean },
  rsvps: readonly RosterRsvp[],
  requireVerification: boolean
): string | null {
  const key = secret()
  if (!key) return null
  const members = rsvps.filter(r => isConfirmedRsvp(r, r.participant, requireVerification))
  const present = event.enableCheckin ? members.filter(r => isPresent(r)).map(r => assemblySubject(assemblyId, r.id, key)) : []
  return sign({
    typ: 'assembly-roster-result', assemblyId, eventId: event.id, checkin: event.enableCheckin, members: members.length, present,
    exp: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS
  }, key)
}

type AttendanceRsvp = RosterRsvp & { participant: { isVerified: boolean; name: string } }

/**
 * Anwesenheitsliste für die Sitzungsleitung (Antwort auf `assembly-attendance`): alle Zusagen, die zählen, mit
 * Pseudonym, Namen der Zusage, ob gerade da und ob schon wieder gegangen (mit Kommen und Gehen). Keine E-Mail, keine
 * Rsvp-ID. Das Abstimmungstool zeigt die Liste nur der Sitzungsleitung und speichert sie nicht. Signiert, null ohne Secret.
 */
export function signAttendanceResult(
  assemblyId: string,
  event: { id: string; enableCheckin: boolean; trackPresence: boolean },
  rsvps: readonly AttendanceRsvp[],
  requireVerification: boolean
): string | null {
  const key = secret()
  if (!key) return null
  const people = rsvps
    .filter(r => isConfirmedRsvp(r, r.participant, requireVerification))
    .map(r => ({
      sub: assemblySubject(assemblyId, r.id, key),
      name: r.participant.name.trim().slice(0, 100),
      present: event.enableCheckin && isPresent(r),
      left: event.enableCheckin && r.hasAttended && !!r.leftAt
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return sign({
    typ: 'assembly-attendance-result', assemblyId, eventId: event.id, checkin: event.enableCheckin, trackPresence: event.trackPresence, people,
    exp: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS
  }, key)
}

export type AssemblyLinkResult = 'ok' | 'conflict' | 'unknown' | 'unreachable'

/**
 * Beim Speichern des Links: meldet dem Abstimmungstool, dass dieser Termin die Sitzung verlinkt (`assembly-link`). Die
 * Sitzung übernimmt den Termin, wenn sie frei ist; "conflict", wenn schon ein anderer Termin sie verknüpft hat.
 */
export async function announceAssemblyLink(assemblyUrl: string, event: { id: string; title: string }): Promise<AssemblyLinkResult> {
  const assembly = assemblyOf({ assemblyUrl })
  const key = secret()
  if (!assembly || !key) return 'unreachable'
  const body = sign({ typ: 'assembly-link', assemblyId: assembly.assemblyId, eventId: event.id, eventTitle: event.title.slice(0, 200), exp: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS }, key)
  try {
    const response = await fetch(`${assembly.origin}/api/rsvp-assembly`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: AbortSignal.timeout(5000)
    })
    if (response.status === 409) return 'conflict'
    if (response.status === 404) return 'unknown'
    return response.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * Liest das Feld aus dem Termin-Formular (fehlt es, bleibt alles, wie es ist) und meldet einen neuen Link dem
 * Abstimmungstool. Gehört die Sitzung schon zu einem anderen Termin oder gibt es sie nicht, bricht das Speichern mit
 * einer Meldung ab; ist das Abstimmungstool nicht erreichbar, verknüpft es sich beim ersten Beitritt.
 */
export async function readAssemblySettings(formData: FormData, event: { id: string; title: string; assemblyUrl: string | null }): Promise<{ assemblyUrl?: string | null }> {
  if (!formData.has('assemblyUrl')) return {}
  const assemblyUrl = parseAssemblyUrl(formData.get('assemblyUrl') as string || '')
  if (assemblyUrl && assemblyUrl !== event.assemblyUrl) {
    const result = await announceAssemblyLink(assemblyUrl, event)
    if (result === 'conflict') throw new InputError('Sitzung: Diese Sitzung ist im Abstimmungstool schon mit einem anderen Termin verknüpft.')
    if (result === 'unknown') throw new InputError('Sitzung: Diese Sitzung gibt es im Abstimmungstool nicht.')
  }
  return { assemblyUrl }
}
