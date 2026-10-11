// app/lib/wishlist.ts
//
// Wunschliste (Idee N4 der Suite, docs/KONZEPT-WUNSCHLISTE.md): Wünsche pro Termin - Geschenke mit Stückzahl oder
// Geldwünsche mit Zielbetrag, an denen sich mehrere mit Teilbeträgen beteiligen. Gäste reservieren über ihren
// persönlichen Link, ohne zu sehen, wer sonst was nimmt. Reine Funktionen ohne Datenbank (auch im Browser nutzbar);
// Speichern in app/lib/wishlist-store.ts.

export const WISH_LIMITS = { wishes: 100, title: 100, description: 500, url: 500, quantity: 99, cents: 10_000_000 }

/** Eingabefehler, die die Person selbst beheben kann - als Meldung zurück ans Formular. */
export class WishInputError extends Error {}

export type WishInput = {
  title: string
  description: string | null
  url: string | null
  priceCents: number | null
  quantity: number
  /** Geldwunsch: Zielbetrag. null = Geschenk mit Stückzahl */
  targetCents: number | null
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1) : ''
}

/** "25", "25,5", "1.200", "1.200,50 €" -> Cent; leer -> null. Wirft bei allem anderen. */
export function parseEuro(text: string, field: string): number | null {
  const value = text.replace(/€|eur/gi, '').replace(/\s/g, '')
  if (!value) return null
  const match = value.match(/^(\d{1,3}(?:\.\d{3})+|\d{1,7})(?:,(\d{1,2}))?$/) ?? value.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/)
  if (!match) throw new WishInputError(`${field}: „${text.trim()}“ ist kein gültiger Betrag (z. B. 25 oder 25,50).`)
  const cents = Number(match[1].replace(/\./g, '')) * 100 + Number((match[2] ?? '0').padEnd(2, '0'))
  if (cents <= 0) throw new WishInputError(`${field}: Der Betrag muss größer als 0 sein.`)
  if (cents > WISH_LIMITS.cents) throw new WishInputError(`${field}: Der Betrag ist zu hoch.`)
  return cents
}

/** Shop- oder Info-Link: nur vollständige http(s)-Adressen, sonst Fehler; leer -> null. */
export function parseWishUrl(text: string): string | null {
  const value = text.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WishInputError('Link: Bitte eine vollständige Adresse eintragen, z. B. https://shop.example.de/kaffeemaschine.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WishInputError('Link: Nur Adressen mit https:// oder http://.')
  if (value.length > WISH_LIMITS.url) throw new WishInputError('Link: Die Adresse ist zu lang.')
  return url.toString()
}

/**
 * Ein Wunsch aus dem Formular der Verwaltung (Felder title, description, url, price, kind = item|money, quantity,
 * target). Wirft mit einer Meldung fürs Formular.
 */
export function readWishInput(formData: FormData): WishInput {
  const title = clean(formData.get('title'), WISH_LIMITS.title)
  if (!title) throw new WishInputError('Bitte eine Bezeichnung eintragen.')
  if (title.length > WISH_LIMITS.title) throw new WishInputError('Die Bezeichnung ist zu lang.')
  const description = clean(formData.get('description'), WISH_LIMITS.description)
  if (description.length > WISH_LIMITS.description) throw new WishInputError('Die Beschreibung ist zu lang.')
  const url = parseWishUrl(String(formData.get('url') ?? ''))
  const priceCents = parseEuro(String(formData.get('price') ?? ''), 'Preis')
  if (formData.get('kind') === 'money') {
    const targetCents = parseEuro(String(formData.get('target') ?? ''), 'Zielbetrag')
    if (targetCents === null) throw new WishInputError('Bitte für den Geldwunsch einen Zielbetrag eintragen.')
    return { title, description: description || null, url, priceCents: null, quantity: 1, targetCents }
  }
  const quantity = Number(String(formData.get('quantity') ?? '1').trim() || '1')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > WISH_LIMITS.quantity) throw new WishInputError(`Anzahl: 1 bis ${WISH_LIMITS.quantity}.`)
  return { title, description: description || null, url, priceCents, quantity, targetCents: null }
}

export type WishReservationRow = { participantId: string; quantity: number; amountCents: number | null }

/** Stand eines Wunschs für einen Gast: wie viel reserviert ist (Stück bzw. Cent), was frei ist, was er selbst hält. */
export type WishState = {
  reserved: number
  /** Geschenk: freie Stück; Geldwunsch: fehlender Betrag bis zum Ziel (0, wenn erreicht) */
  remaining: number
  full: boolean
  mine: { quantity: number; amountCents: number | null } | null
}

export function wishState(wish: { quantity: number; targetCents: number | null }, reservations: readonly WishReservationRow[], participantId: string | null): WishState {
  const own = participantId ? reservations.find(r => r.participantId === participantId) : undefined
  const mine = own ? { quantity: own.quantity, amountCents: own.amountCents } : null
  if (wish.targetCents !== null) {
    const reserved = reservations.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)
    return { reserved, remaining: Math.max(wish.targetCents - reserved, 0), full: reserved >= wish.targetCents, mine }
  }
  const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0)
  return { reserved, remaining: Math.max(wish.quantity - reserved, 0), full: reserved >= wish.quantity, mine }
}
