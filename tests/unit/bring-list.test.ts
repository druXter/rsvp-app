import { describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/client', () => ({ PrismaClient: class {} }))
const { claimedLabels, formatBringSlots, parseBringSlots, BRING_LIMITS } = await import('../../app/lib/bring-list')

describe('parseBringSlots (Textfeld der Verwaltung)', () => {
  it('eine Zeile pro Eintrag, Anzahl optional vorne', () => {
    expect(parseBringSlots('2x Salat\n\n  Getränke  \n3 x Kuchen\n2× Brot\r\nNachtisch')).toEqual([
      { label: 'Salat', quantity: 2 }, { label: 'Getränke', quantity: 1 }, { label: 'Kuchen', quantity: 3 },
      { label: 'Brot', quantity: 2 }, { label: 'Nachtisch', quantity: 1 }
    ])
    expect(parseBringSlots('')).toEqual([])
  })

  it('doppelte Bezeichnungen werden zusammengefasst', () => {
    expect(parseBringSlots('Salat\n2x Salat')).toEqual([{ label: 'Salat', quantity: 3 }])
  })

  it('Zahlen ohne x gehören zur Bezeichnung', () => {
    expect(parseBringSlots('5 Liter Bowle')).toEqual([{ label: '5 Liter Bowle', quantity: 1 }])
  })

  it('Grenzen: Anzahl, Länge, Zahl der Einträge', () => {
    expect(() => parseBringSlots('0x Salat')).toThrow('zwischen 1 und')
    expect(() => parseBringSlots(`${BRING_LIMITS.quantity + 1}x Salat`)).toThrow('zwischen 1 und')
    expect(() => parseBringSlots('a'.repeat(BRING_LIMITS.label + 1))).toThrow('zu lang')
    expect(() => parseBringSlots(Array.from({ length: BRING_LIMITS.slots + 1 }, (_, i) => `Eintrag ${i}`).join('\n'))).toThrow('höchstens')
  })

  it('formatBringSlots ist das Gegenstück', () => {
    const slots = [{ label: 'Salat', quantity: 2 }, { label: 'Nachtisch', quantity: 1 }]
    expect(formatBringSlots(slots)).toBe('2x Salat\nNachtisch')
    expect(parseBringSlots(formatBringSlots(slots))).toEqual(slots)
  })
})

describe('claimedLabels', () => {
  it('in der Reihenfolge der Liste', () => {
    expect(claimedLabels({ bringClaims: [{ slot: { label: 'B', position: 2 } }, { slot: { label: 'A', position: 0 } }] })).toEqual(['A', 'B'])
    expect(claimedLabels({})).toEqual([])
  })
})
