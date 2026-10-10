import { describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/client', () => ({ PrismaClient: class {} }))
const { formatTicketCategories, hasRoom, nextToPromote, parsePrice, parseTicketCategories, TICKET_LIMITS } = await import('../../app/lib/tickets')

describe('parseTicketCategories (Textfeld der Verwaltung)', () => {
  it('Bezeichnung; Preis; Kontingent - Preis und Kontingent optional', () => {
    expect(parseTicketCategories('Studierende; 25; 120\n\n Gäste ; 35,50 \r\nHelfer*innen; 0; 20\nEhrengäste')).toEqual([
      { label: 'Studierende', priceCents: 2500, capacity: 120 },
      { label: 'Gäste', priceCents: 3550, capacity: null },
      { label: 'Helfer*innen', priceCents: 0, capacity: 20 },
      { label: 'Ehrengäste', priceCents: 0, capacity: null }
    ])
    expect(parseTicketCategories('')).toEqual([])
    // Kontingent ohne Preis
    expect(parseTicketCategories('Frei; ; 10')).toEqual([{ label: 'Frei', priceCents: 0, capacity: 10 }])
  })

  it('Preise: Komma, Punkt, Eurozeichen, "frei"', () => {
    expect(parsePrice('25', 'x')).toBe(2500)
    expect(parsePrice('25,5', 'x')).toBe(2550)
    expect(parsePrice('25.05', 'x')).toBe(2505)
    expect(parsePrice('€ 12,00', 'x')).toBe(1200)
    expect(parsePrice('12 EUR', 'x')).toBe(1200)
    expect(parsePrice('frei', 'x')).toBe(0)
    expect(() => parsePrice('-5', 'x')).toThrow(/ungültig/)
    expect(() => parsePrice('1.000,00', 'x')).toThrow(/ungültig/)
    expect(() => parsePrice('25,555', 'x')).toThrow(/ungültig/)
    expect(() => parsePrice('100000', 'x')).toThrow(/zu hoch/)
  })

  it('Fehler mit Meldung fürs Formular', () => {
    expect(() => parseTicketCategories('; 25')).toThrow(/Bezeichnung/)
    expect(() => parseTicketCategories('A; 5\nA; 6')).toThrow(/doppelt/)
    expect(() => parseTicketCategories('A; 5; 0')).toThrow(/Kontingent/)
    expect(() => parseTicketCategories('A; 5; 2,5')).toThrow(/Kontingent/)
    expect(() => parseTicketCategories('A; 5; 10; x')).toThrow(/zu viele/)
    expect(() => parseTicketCategories('x'.repeat(TICKET_LIMITS.label + 1))).toThrow(/zu lang/)
    expect(() => parseTicketCategories(Array.from({ length: TICKET_LIMITS.categories + 1 }, (_, i) => `K${i}`).join('\n'))).toThrow(/höchstens/)
  })

  it('formatTicketCategories ist das Gegenstück', () => {
    const text = 'Studierende; 25; 120\nGäste; 35,50\nHelfer*innen; 0; 20\nEhrengäste'
    expect(formatTicketCategories(parseTicketCategories(text))).toBe(text)
    expect(parseTicketCategories(formatTicketCategories([{ label: 'A', priceCents: 1005, capacity: null }]))).toEqual([{ label: 'A', priceCents: 1005, capacity: null }])
  })
})

describe('Platzregel', () => {
  const fixed = (id: string, cat: string | null) => ({ id, isAttending: true, isOnWaitlist: false, ticketCategoryId: cat })
  const waiting = (id: string, cat: string | null) => ({ id, isAttending: true, isOnWaitlist: true, ticketCategoryId: cat })
  const limits = { maxCapacity: 4, categories: [{ id: 'stud', capacity: 2 }, { id: 'gast', capacity: null }] }

  it('Gesamtkapazität und Kontingent müssen beide Platz haben', () => {
    expect(hasRoom(limits, [fixed('a', 'stud')], 'stud')).toBe(true)
    expect(hasRoom(limits, [fixed('a', 'stud'), fixed('b', 'stud')], 'stud')).toBe(false)
    expect(hasRoom(limits, [fixed('a', 'stud'), fixed('b', 'stud')], 'gast')).toBe(true)
    expect(hasRoom(limits, [fixed('a', 'gast'), fixed('b', 'gast'), fixed('c', 'gast'), fixed('d', 'gast')], 'stud')).toBe(false)
    // Warteliste und Absagen belegen nichts
    expect(hasRoom(limits, [fixed('a', 'stud'), waiting('b', 'stud'), { ...fixed('c', 'stud'), isAttending: false }], 'stud')).toBe(true)
    // Ohne Grenzen immer Platz
    expect(hasRoom({ maxCapacity: null, categories: [] }, [fixed('a', null)], null)).toBe(true)
  })

  it('die eigene Antwort zählt nicht mit', () => {
    expect(hasRoom(limits, [fixed('a', 'stud'), fixed('b', 'stud')], 'stud', 'b')).toBe(true)
  })

  it('Nachrücken: am längsten wartend, für die Platz ist - eine volle Kategorie blockiert die anderen nicht', () => {
    const rsvps = [fixed('a', 'stud'), fixed('b', 'stud'), fixed('c', 'gast'), waiting('w1', 'stud'), waiting('w2', 'gast'), waiting('w3', 'gast')]
    const queue = rsvps.filter(r => r.isOnWaitlist)
    expect(nextToPromote(limits, rsvps, queue)?.id).toBe('w2')
    // Gesamt voll: niemand
    expect(nextToPromote({ ...limits, maxCapacity: 3 }, rsvps, queue)).toBeNull()
    // Kontingent "stud" frei: w1 zuerst (FIFO)
    expect(nextToPromote(limits, rsvps.filter(r => r.id !== 'a'), queue)?.id).toBe('w1')
  })
})
