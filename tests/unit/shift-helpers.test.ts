import { describe, expect, it } from 'vitest'
import { createSignedMessage, toolDefinition } from '../../app/lib/linked-tools'
import { formatShiftTiers, parseStoredTiers, readShiftTiers, storedTiers, tierFor, verifyShiftHelpers } from '../../app/lib/shift-helpers'

// Vertrag mit Schichten (app/lib/shift-helpers.ts, Gegenstück dort app/lib/rsvp/token.ts).
const secret = 'test-shifts-secret-0123456789abcdef01234'
const audience = 'https://rsvp.example.test'
const now = new Date('2026-12-01T12:00:00Z')
const envelope = { aud: audience, shiftsEventId: 'cmshiftsevent00001', rsvpEventId: 'cmrsvpevent00000001', seq: now.getTime() }
const anna = { helperId: 'cmhelperanna00001', name: 'Anna', email: 'anna@example.test', shifts: 2 }
// Von Schichten (createHelpersMessage) mit genau diesen Werten erzeugt - prüft, dass beide Seiten dasselbe Format sprechen.
const SCHICHTEN_SHIFT_HELPERS =
  'eyJ0eXAiOiJzaGlmdC1oZWxwZXJzIiwiYXVkIjoiaHR0cHM6Ly9yc3ZwLmV4YW1wbGUudGVzdCIsInNoaWZ0c0V2ZW50SWQiOiJjbXNoaWZ0c2V2ZW50MDAwMDEiLCJyc3ZwRXZlbnRJZCI6ImNtcnN2cGV2ZW50MDAwMDAwMDEiLCJzZXEiOjE3OTYxMjY0MDAwMDAsImhlbHBlcnMiOlt7ImhlbHBlcklkIjoiY21oZWxwZXJhbm5hMDAwMDEiLCJuYW1lIjoiQW5uYSIsImVtYWlsIjoiYW5uYUBleGFtcGxlLnRlc3QiLCJzaGlmdHMiOjJ9XSwiaWF0IjoxNzk2MTI2NDAwLCJleHAiOjE3OTYxMjcwMDB9.ttWGXZ8RmInis3ovvo3GAUgrQ_EIaFXPOWabJ4z2FSM'

const sign = (fields: object, options: { secret?: string; now?: Date } = {}) =>
  createSignedMessage('shift-helpers', fields, options.secret ?? secret, { now: options.now ?? now })

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('Vertrag mit Schichten', () => {
  it('Tool-Definition', () => {
    expect(toolDefinition('shifts')).toMatchObject({ label: 'Schichten', secretEnv: 'SHIFTS_SECRET', baseUrlEnv: 'SHIFTS_BASE_URL', formField: 'shiftsUrl', linkSegment: 'rsvp', remoteIdField: 'shiftsEventId' })
  })

  it('liest die Meldung, wie Schichten sie erzeugt', () => {
    expect(verifyShiftHelpers(SCHICHTEN_SHIFT_HELPERS, { secret, audience, now })).toEqual({ ...envelope, iat: now.getTime() / 1000, exp: now.getTime() / 1000 + 600, helpers: [anna] })
  })

  it('liest eine gültige Meldung, E-Mail kleingeschrieben', () => {
    const message = verifyShiftHelpers(sign({ ...envelope, helpers: [{ ...anna, email: 'Anna@Example.test' }] }), { secret, audience, now })
    expect(message).toMatchObject({ shiftsEventId: 'cmshiftsevent00001', rsvpEventId: 'cmrsvpevent00000001', seq: now.getTime(), helpers: [anna] })
  })

  it('lehnt falsche Signatur, Empfänger, Art und ungültigen Inhalt ab', () => {
    const helpers = [anna]
    expect(verifyShiftHelpers(sign({ ...envelope, helpers }, { secret: 'x'.repeat(40) }), { secret, audience, now })).toBeNull()
    expect(verifyShiftHelpers(sign({ ...envelope, aud: 'https://evil.example', helpers }), { secret, audience, now })).toBeNull()
    expect(verifyShiftHelpers(createSignedMessage('placements', { ...envelope, helpers }, secret, { now }), { secret, audience, now })).toBeNull()
    for (const bad of [
      [{ ...anna, email: 'keine-adresse' }], [{ ...anna, shifts: -1 }], [{ ...anna, shifts: 1.5 }], [{ ...anna, name: '' }],
      [{ ...anna, helperId: 'x' }], [anna, { ...anna, email: 'b@example.test' }], [anna, { ...anna, helperId: 'cmhelperanna00002' }]
    ]) {
      expect(verifyShiftHelpers(sign({ ...envelope, helpers: bad }), { secret, audience, now }), JSON.stringify(bad)).toBeNull()
    }
    expect(verifyShiftHelpers(sign({ ...envelope, seq: 'x', helpers }), { secret, audience, now })).toBeNull()
  })
})

describe('Stufen', () => {
  const categories = [{ id: 'c1', label: 'Helfer*innen' }, { id: 'c2', label: 'Helfer*innen plus' }]

  it('höchste erreichte Stufe gilt', () => {
    const tiers = [{ min: 1, categoryId: 'c1' }, { min: 5, categoryId: 'c2' }]
    expect(tierFor(tiers, 0)).toBeNull()
    expect(tierFor(tiers, 4)?.categoryId).toBe('c1')
    expect(tierFor(tiers, 5)?.categoryId).toBe('c2')
    expect(tierFor([], 10)).toBeNull()
  })

  it('Formular: Zeilen mit Kategorie, sortiert, Rundweg über ids', () => {
    const tiers = readShiftTiers(form({ shiftTiers: '5: helfer*innen plus\n1: Helfer*innen\n' }), categories.map(c => c.label))
    expect(tiers).toEqual([{ min: 1, label: 'Helfer*innen' }, { min: 5, label: 'Helfer*innen plus' }])
    const stored = storedTiers(tiers!, categories)
    expect(parseStoredTiers(stored)).toEqual([{ min: 1, categoryId: 'c1' }, { min: 5, categoryId: 'c2' }])
    expect(formatShiftTiers(parseStoredTiers(stored), categories)).toBe('1: Helfer*innen\n5: Helfer*innen plus')
    expect(readShiftTiers(form({ shiftTiers: '' }), categories.map(c => c.label))).toEqual([])
    expect(storedTiers([], categories)).toBeNull()
    expect(readShiftTiers(new FormData(), [])).toBeUndefined()
  })

  it('Formular: Fehler vor dem Speichern', () => {
    const labels = categories.map(c => c.label)
    expect(() => readShiftTiers(form({ shiftTiers: '1: Unbekannt' }), labels)).toThrow('fehlt eine der Kategorien')
    expect(() => readShiftTiers(form({ shiftTiers: '1: Helfer*innen\n1: Helfer*innen plus' }), labels)).toThrow('doppelt')
    expect(() => readShiftTiers(form({ shiftTiers: '0: Helfer*innen' }), labels)).toThrow('zwischen 1 und 100')
    expect(() => readShiftTiers(form({ shiftTiers: 'viele' }), labels)).toThrow('erwartet')
    // Ohne Kategorien: nur eine Zahl
    expect(readShiftTiers(form({ shiftTiers: '2' }), [])).toEqual([{ min: 2, label: null }])
    expect(() => readShiftTiers(form({ shiftTiers: '2: Helfer*innen' }), [])).toThrow('nur die Zahl')
    expect(() => readShiftTiers(form({ shiftTiers: '1\n3' }), [])).toThrow('nur eine Stufe')
  })
})
