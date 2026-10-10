import { describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/client', () => ({ PrismaClient: class {} }))
const { epcPayload, formatIban, generatePaymentReference, isValidBic, isValidIban, paymentDue, paymentState, readPaymentSettings } = await import('../../app/lib/payment')
const { formatEuro } = await import('../../app/lib/payment-state')

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

describe('IBAN und BIC', () => {
  it('Prüfsumme (mod 97), Leerzeichen und Kleinbuchstaben egal', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('de89370400440532013000')).toBe(true)
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(isValidIban('DE89 3704 0044 0532 0130 01')).toBe(false)
    expect(isValidIban('DE89 3704 0044 0532 0130')).toBe(false)
    expect(isValidIban('')).toBe(false)
    expect(formatIban('de89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
  })

  it('BIC mit 8 oder 11 Zeichen', () => {
    expect(isValidBic('COBADEFFXXX')).toBe(true)
    expect(isValidBic('COBADEFF')).toBe(true)
    expect(isValidBic('COBADE')).toBe(false)
  })
})

describe('readPaymentSettings', () => {
  it('ohne Abschnitt im Formular: unangetastet', () => {
    expect(readPaymentSettings(form({}), true)).toBeNull()
  })

  it('liest und normalisiert', () => {
    expect(readPaymentSettings(form({ paymentRecipient: ' Fachschaft ', paymentIban: 'de89 3704 0044 0532 0130 00', paymentBic: 'cobadeff', paymentDueDays: '14' }), true))
      .toEqual({ paymentRecipient: 'Fachschaft', paymentIban: 'DE89370400440532013000', paymentBic: 'COBADEFF', paymentDueDays: 14 })
    expect(readPaymentSettings(form({ paymentRecipient: '', paymentIban: '', paymentBic: '', paymentDueDays: '' }), false))
      .toEqual({ paymentRecipient: null, paymentIban: null, paymentBic: null, paymentDueDays: null })
  })

  it('Pflicht bei Preisen, Prüfungen', () => {
    expect(() => readPaymentSettings(form({ paymentRecipient: '', paymentIban: '' }), true)).toThrow(/Pflicht/)
    expect(() => readPaymentSettings(form({ paymentRecipient: 'X', paymentIban: 'DE00 1234' }), false)).toThrow(/IBAN/)
    expect(() => readPaymentSettings(form({ paymentRecipient: 'X', paymentIban: '', paymentBic: 'XX' }), false)).toThrow(/BIC/)
    expect(() => readPaymentSettings(form({ paymentRecipient: 'x'.repeat(71), paymentIban: '' }), false)).toThrow(/70/)
    expect(() => readPaymentSettings(form({ paymentRecipient: '', paymentIban: '', paymentDueDays: '0' }), false)).toThrow(/Zahlfrist/)
  })
})

describe('GiroCode und Verwendungszweck', () => {
  it('EPC QR Version 002 nach EPC069-12', () => {
    expect(epcPayload({ recipient: 'Fachschaft Musterfach', iban: 'DE89 3704 0044 0532 0130 00', bic: null, amountCents: 2550, reference: 'BALL-7KQ3M2XZ' }))
      .toBe('BCD\n002\n1\nSCT\n\nFachschaft Musterfach\nDE89370400440532013000\nEUR25.50\n\n\nBALL-7KQ3M2XZ')
    expect(epcPayload({ recipient: 'A', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amountCents: 100, reference: 'X' }).split('\n')[4]).toBe('COBADEFFXXX')
  })

  it('Verwendungszweck: Präfix aus dem Slug, 8 eindeutige Zeichen ohne Verwechsler', () => {
    const ref = generatePaymentReference('winterball-2026')
    expect(ref).toMatch(/^WINTERBA-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
    expect(generatePaymentReference('---')).toMatch(/^TICKET-/)
    expect(new Set(Array.from({ length: 200 }, () => generatePaymentReference('x'))).size).toBe(200)
  })

  it('Euro-Format', () => {
    expect(formatEuro(2550).replace(/\s/g, ' ')).toBe('25,50 €')
  })
})

describe('Zahlstatus', () => {
  const base = { isAttending: true, isOnWaitlist: false, amountCents: 2500, paymentDueAt: null, paidAt: null, refundedAt: null }
  const now = new Date('2026-10-10T12:00:00Z')

  it('offen, überfällig, bezahlt', () => {
    expect(paymentState(base, now)).toBe('open')
    expect(paymentState({ ...base, paymentDueAt: new Date('2026-10-11T00:00:00Z') }, now)).toBe('open')
    expect(paymentState({ ...base, paymentDueAt: new Date('2026-10-09T00:00:00Z') }, now)).toBe('overdue')
    expect(paymentState({ ...base, paidAt: now }, now)).toBe('paid')
    expect(paymentDue({ ...base, paymentDueAt: new Date('2026-10-09T00:00:00Z') }, now)).toBe(true)
    expect(paymentDue({ ...base, paidAt: now }, now)).toBe(false)
  })

  it('nichts fällig: kostenlos, Warteliste, Absage', () => {
    expect(paymentState({ ...base, amountCents: 0 }, now)).toBe('none')
    expect(paymentState({ ...base, amountCents: null }, now)).toBe('none')
    expect(paymentState({ ...base, isOnWaitlist: true }, now)).toBe('none')
    expect(paymentState({ ...base, isAttending: false }, now)).toBe('none')
  })

  it('bezahlt und abgesagt: Erstattung', () => {
    expect(paymentState({ ...base, isAttending: false, paidAt: now }, now)).toBe('refund-open')
    expect(paymentState({ ...base, isAttending: false, paidAt: now, refundedAt: now }, now)).toBe('refunded')
  })
})
