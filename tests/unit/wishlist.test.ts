import { describe, expect, it } from 'vitest'
import { parseEuro, parseWishUrl, readWishInput, wishState, WishInputError } from '../../app/lib/wishlist'

describe('Wunschliste (docs/KONZEPT-WUNSCHLISTE.md)', () => {
  it('parseEuro: deutsche und einfache Schreibweisen, leer = null, sonst Fehler', () => {
    expect(parseEuro('25', 'Preis')).toBe(2500)
    expect(parseEuro('25,5 €', 'Preis')).toBe(2550)
    expect(parseEuro('1.200,50', 'Preis')).toBe(120050)
    expect(parseEuro('1.200', 'Preis')).toBe(120000)
    expect(parseEuro('25.50', 'Preis')).toBe(2550)
    expect(parseEuro('  ', 'Preis')).toBeNull()
    for (const bad of ['abc', '0', '-5', '1,234', '100000000']) expect(() => parseEuro(bad, 'Betrag')).toThrow(WishInputError)
  })

  it('parseWishUrl: nur http(s)', () => {
    expect(parseWishUrl(' https://shop.example.de/x ')).toBe('https://shop.example.de/x')
    expect(parseWishUrl('')).toBeNull()
    expect(() => parseWishUrl('javascript:alert(1)')).toThrow('https://')
    expect(() => parseWishUrl('shop.example.de')).toThrow(WishInputError)
  })

  it('readWishInput: Geschenk mit Anzahl oder Geldwunsch mit Zielbetrag', () => {
    const form = (fields: Record<string, string>) => {
      const data = new FormData()
      for (const [k, v] of Object.entries(fields)) data.set(k, v)
      return data
    }
    expect(readWishInput(form({ title: ' Weingläser ', quantity: '6', price: '8', kind: 'item' })))
      .toEqual({ title: 'Weingläser', description: null, url: null, priceCents: 800, quantity: 6, targetCents: null })
    expect(readWishInput(form({ title: 'Reise', kind: 'money', target: '2.000', quantity: '9', price: '5' })))
      .toEqual({ title: 'Reise', description: null, url: null, priceCents: null, quantity: 1, targetCents: 200000 })
    expect(() => readWishInput(form({ title: '', kind: 'item' }))).toThrow('Bezeichnung')
    expect(() => readWishInput(form({ title: 'Reise', kind: 'money' }))).toThrow('Zielbetrag')
    expect(() => readWishInput(form({ title: 'X', quantity: '0' }))).toThrow('Anzahl')
    expect(() => readWishInput(form({ title: 'X', quantity: '1.5' }))).toThrow('Anzahl')
    expect(() => readWishInput(form({ title: 'x'.repeat(101) }))).toThrow('zu lang')
  })

  it('wishState: Stück bzw. Betrag, eigene Reservierung, voll', () => {
    const rows = [{ participantId: 'a', quantity: 2, amountCents: null }, { participantId: 'b', quantity: 3, amountCents: null }]
    expect(wishState({ quantity: 6, targetCents: null }, rows, 'a')).toEqual({ reserved: 5, remaining: 1, full: false, mine: { quantity: 2, amountCents: null } })
    expect(wishState({ quantity: 5, targetCents: null }, rows, null)).toMatchObject({ remaining: 0, full: true, mine: null })
    const money = [{ participantId: 'a', quantity: 1, amountCents: 5000 }, { participantId: 'b', quantity: 1, amountCents: 20000 }]
    expect(wishState({ quantity: 1, targetCents: 20000 }, money, 'b')).toEqual({ reserved: 25000, remaining: 0, full: true, mine: { quantity: 1, amountCents: 20000 } })
  })
})
