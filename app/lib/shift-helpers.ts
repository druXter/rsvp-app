// app/lib/shift-helpers.ts
import { configuredTool, resolveToolOrigin, toolDefinition, toolLinkOf, verifyEnvelope, type ConfiguredTool, type StoredToolLink, type ToolLink } from './linked-tools'
import { InputError } from './input-error'

/**
 * Vertrag mit Schichten (Dienste und Schichten, eigenes Repo - dort app/lib/rsvp/token.ts und docs/KONZEPT.md
 * Abschnitt 8). Format wie bei allen verknüpften Tools (app/lib/linked-tools.ts), mit EIGENEM Secret SHIFTS_SECRET
 * (dort RSVP_SHIFTS_SECRET). Eine Art, nur Schichten -> rsvp-app:
 *
 * - shift-helpers: { typ, aud, shiftsEventId, rsvpEventId, seq, helpers: [{ helperId, name, email, shifts }], iat, exp }
 *   an /api/shifts/helpers - der VOLLSTÄNDIGE Stand aller bestätigten Helfer*innen mit der Zahl ihrer Schichten.
 *   seq (Millisekunden) ordnet Meldungen derselben Sekunde; ältere werden verworfen.
 *
 * Wer genug Schichten hat, bekommt hier eine Zusage in der Kategorie seiner Stufe (Event.shiftTiers, „ab N
 * Schichten → Kategorie“). Datei ohne Datenbankzugriffe (Unit-Tests); anwenden: app/lib/shift-helpers-store.ts.
 */

const SHIFTS = toolDefinition('shifts')
export const MAX_HELPERS = 5000
const MAX_NAME = 200
const MAX_SHIFTS = 1000
const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/
const HELPER_ID = /^[A-Za-z0-9_-]{8,64}$/

export function allowedShiftsOrigin(): string | null {
  return resolveToolOrigin(SHIFTS)
}

export function shiftsTool(): ConfiguredTool | null {
  return configuredTool('shifts')
}

export function shiftsLinkOf(event: { id: string; toolLinks: StoredToolLink[] }): ToolLink | null {
  return toolLinkOf(event, 'shifts')
}

export type ShiftHelper = { helperId: string; name: string; email: string; shifts: number }
export type ShiftHelpersMessage = { aud: string; iat: number; exp: number; shiftsEventId: string; rsvpEventId: string; seq: number; helpers: ShiftHelper[] }

function readHelper(value: unknown): ShiftHelper | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { helperId, name, email, shifts } = value as Record<string, unknown>
  if (typeof helperId !== 'string' || !HELPER_ID.test(helperId)) return null
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) return null
  if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email)) return null
  if (!Number.isInteger(shifts) || (shifts as number) < 0 || (shifts as number) > MAX_SHIFTS) return null
  return { helperId, name: name.trim(), email: email.toLowerCase(), shifts: shifts as number }
}

/** Prüft Signatur, Art, Empfänger, Gültigkeit und Inhalt - oder null. Doppelte helperId/E-Mail: ungültig. */
export function verifyShiftHelpers(token: unknown, options: { secret: string; audience: string; now?: Date }): ShiftHelpersMessage | null {
  const verified = verifyEnvelope(token, 'shift-helpers', { ...options, remoteIdField: SHIFTS.remoteIdField })
  if (!verified) return null
  const { raw, envelope } = verified
  if (!Number.isSafeInteger(raw.seq) || (raw.seq as number) < 0) return null
  if (!Array.isArray(raw.helpers) || raw.helpers.length > MAX_HELPERS) return null
  const helpers = raw.helpers.map(readHelper)
  if (helpers.some(h => h === null)) return null
  const valid = helpers as ShiftHelper[]
  if (new Set(valid.map(h => h.helperId)).size !== valid.length || new Set(valid.map(h => h.email)).size !== valid.length) return null
  return { aud: envelope.aud, iat: envelope.iat, exp: envelope.exp, shiftsEventId: envelope.remoteEventId, rsvpEventId: envelope.rsvpEventId, seq: raw.seq as number, helpers: valid }
}

// --- Stufen -------------------------------------------------------------------------------------

export type ShiftTier = { min: number; categoryId: string | null }

/** Gespeicherte Stufen (Event.shiftTiers) - unlesbar oder leer = keine. Aufsteigend nach min. */
export function parseStoredTiers(stored: string | null): ShiftTier[] {
  if (!stored) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is ShiftTier => typeof t === 'object' && t !== null && Number.isInteger(t.min) && t.min >= 1 && (t.categoryId === null || typeof t.categoryId === 'string'))
      .sort((a, b) => a.min - b.min)
  } catch {
    return []
  }
}

/** Die höchste erreichte Stufe - oder null (zu wenige Schichten bzw. keine Stufen). */
export function tierFor(tiers: readonly ShiftTier[], shifts: number): ShiftTier | null {
  let result: ShiftTier | null = null
  for (const tier of tiers) if (shifts >= tier.min) result = tier
  return result
}

type Category = { id: string; label: string }

/** Eine Stufe, wie sie im Formular steht - mit der Bezeichnung der Kategorie statt ihrer id. */
export type ShiftTierInput = { min: number; label: string | null }

/**
 * Textfeld „Stufen“ im Termin-Formular: eine Zeile pro Stufe, „1: Helfer*innen“ (ab 1 Schicht Kategorie
 * Helfer*innen). Ohne Ticketkategorien nur eine Zeile mit der Zahl („1“). Leer = keine Stufen. undefined, wenn das
 * Feld im Formular fehlt (unverändert lassen). categoryLabels: die Kategorien, wie sie gespeichert werden. Wirft
 * InputError, BEVOR etwas gespeichert ist (unbekannte Kategorie, doppelte Zahl).
 */
export function readShiftTiers(formData: FormData, categoryLabels: readonly string[]): ShiftTierInput[] | undefined {
  if (!formData.has('shiftTiers')) return undefined
  const text = String(formData.get('shiftTiers') ?? '').slice(0, 2000)
  const tiers: ShiftTierInput[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = /^(\d{1,3})\s*(?::\s*(.*))?$/.exec(line)
    if (!match) throw new InputError(`Schichten: „${line.slice(0, 40)}“ – erwartet „Zahl: Kategorie“, z. B. „1: Helfer*innen“.`)
    const min = Number(match[1])
    if (min < 1 || min > 100) throw new InputError('Schichten: Die Zahl der Schichten muss zwischen 1 und 100 liegen.')
    const label = (match[2] ?? '').trim()
    let category: string | null = null
    if (categoryLabels.length > 0) {
      category = categoryLabels.find(c => c.toLowerCase() === label.toLowerCase()) ?? null
      if (!category) throw new InputError(`Schichten: Bei „${line.slice(0, 40)}“ fehlt eine der Kategorien (${categoryLabels.join(', ')}).`)
    } else if (label) {
      throw new InputError('Schichten: Ohne Ticketkategorien nur die Zahl angeben (ab wie vielen Schichten es eine Zusage gibt).')
    }
    if (tiers.some(t => t.min === min)) throw new InputError(`Schichten: Die Zahl ${min} steht doppelt.`)
    tiers.push({ min, label: category })
  }
  if (categoryLabels.length === 0 && tiers.length > 1) throw new InputError('Schichten: Ohne Ticketkategorien gibt es nur eine Stufe.')
  return tiers.sort((a, b) => a.min - b.min)
}

/** Nach dem Speichern der Kategorien: Bezeichnungen in ids umsetzen (Event.shiftTiers), leer = null. */
export function storedTiers(tiers: readonly ShiftTierInput[], categories: readonly Category[]): string | null {
  if (tiers.length === 0) return null
  return JSON.stringify(tiers.map(t => ({ min: t.min, categoryId: t.label ? categories.find(c => c.label === t.label)?.id ?? null : null })))
}

export function formatShiftTiers(tiers: readonly ShiftTier[], categories: readonly Category[]): string {
  return tiers.map(t => {
    const label = t.categoryId ? categories.find(c => c.id === t.categoryId)?.label : null
    return label ? `${t.min}: ${label}` : String(t.min)
  }).join('\n')
}
