// app/lib/bank-import.ts
//
// Kontoauszug-Import (docs/KONZEPT-TICKETS.md, Abschnitt "Kontoauszug-Import"): Die Verwaltung lädt den Export
// ihrer Bank hoch, rsvp-app sucht darin die Verwendungszwecke der Zusagen eines Termins und schlägt vor, welche
// als bezahlt markiert werden. Absichtlich unabhängig vom Format der Bank: Jede Bank hat ein eigenes CSV (Spalten,
// Trennzeichen, Kodierung), dazu kommt CAMT.053 als XML. Statt Spalten zu deuten, wird jede Buchung als Text
// durchsucht - der Verwendungszweck ist eindeutig genug. Die Datei wird nur im Arbeitsspeicher gelesen und nie
// gespeichert (sie enthält Namen und IBANs der zahlenden Personen und alle anderen Buchungen des Kontos).
// Reine Funktionen ohne Datenbank.

export const BANK_IMPORT_MAX_BYTES = 1_500_000

/** UTF-8 (mit oder ohne BOM), sonst Windows-1252 - viele deutsche Banken exportieren noch in ANSI. */
export function decodeStatement(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

/**
 * Teilt den Auszug in Buchungen. CAMT (XML): je Einzelumsatz (<TxDtls>), sonst je Buchung (<Ntry>). CSV: je
 * Zeile, aber Zeilenumbrüche innerhalb von Anführungszeichen gehören zum Feld (mehrzeiliger Verwendungszweck).
 */
export function splitRecords(text: string): string[] {
  if (/<Ntry[\s>]/.test(text)) {
    const tag = /<TxDtls[\s>]/.test(text) ? 'TxDtls' : 'Ntry'
    return text.split(new RegExp(`<${tag}[\\s>]`)).slice(1)
  }
  const records: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current.trim()) records.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) records.push(current)
  return records
}

/** Nur Großbuchstaben und Ziffern: Banken entfernen Bindestriche, ändern die Schreibweise oder brechen um. */
export function normalizeForMatch(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Alle Geldbeträge einer Buchung in Cent: deutsches Format ("1.234,50", "-25,00"), CAMT/englisch ("25.00").
 * Datumsangaben wie "10.10.2026" zählen nicht.
 */
export function amountsIn(record: string): number[] {
  const result: number[] = []
  const pattern = /(?<![\d.,])([-+]?)(\d{1,3}(?:\.\d{3})+|\d+)([.,])(\d{2})(?![\d.,])/g
  for (const match of record.matchAll(pattern)) {
    const [, sign, whole, separator, cents] = match
    // "1.234" mit Punkt als Tausender nur zusammen mit Komma als Dezimaltrenner
    if (separator === '.' && whole.includes('.')) continue
    const value = Number(whole.replace(/\./g, '')) * 100 + Number(cents)
    result.push(sign === '-' ? -value : value)
  }
  return result
}

export type ImportCandidate = { rsvpId: string; reference: string; amountCents: number }

export type ImportMatch = {
  rsvpId: string
  reference: string
  /** Wie oft der Verwendungszweck im Auszug vorkommt (mehr als 1: doppelt überwiesen?) */
  occurrences: number
  /** Der erwartete Betrag steht als Gutschrift in mindestens einer dieser Buchungen */
  amountMatches: boolean
  /** Gutschriften in diesen Buchungen, zur Anzeige bei abweichendem Betrag */
  amountsFound: number[]
}

export type ImportResult = {
  records: number
  matches: ImportMatch[]
  /** Codes mit dem Präfix des Termins, die zu keiner Zusage passen (Tippfehler?), mit naheliegendem Vorschlag */
  unknownCodes: { code: string; suggestion: string | null }[]
}

const CODE_LENGTH = 8

/** Unterscheiden sich zwei gleich lange Codes in höchstens einem Zeichen (ein Tippfehler)? */
function oneOff(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
  return true
}

/**
 * Sucht die Verwendungszwecke der Kandidaten im Auszug. `prefix` ist der Präfix des Termins (vor dem
 * Bindestrich) - damit werden zusätzlich unbekannte Codes desselben Termins gemeldet.
 */
export function matchStatement(text: string, candidates: readonly ImportCandidate[], prefix: string): ImportResult {
  const records = splitRecords(text).map(raw => ({ raw, normalized: normalizeForMatch(raw) }))
  const matches: ImportMatch[] = []
  const known = new Set<string>()
  for (const candidate of candidates) {
    const needle = normalizeForMatch(candidate.reference)
    known.add(needle)
    const hits = records.filter(r => r.normalized.includes(needle))
    if (hits.length === 0) continue
    const amountsFound = hits.flatMap(r => amountsIn(r.raw)).filter(a => a > 0)
    matches.push({
      rsvpId: candidate.rsvpId,
      reference: candidate.reference,
      occurrences: hits.length,
      amountMatches: amountsFound.includes(candidate.amountCents),
      amountsFound: [...new Set(amountsFound)]
    })
  }

  const unknownCodes: ImportResult['unknownCodes'] = []
  const normalizedPrefix = normalizeForMatch(prefix)
  if (normalizedPrefix) {
    // Nur Zeichen, die in Codes vorkommen (generatePaymentReference): sonst würde z. B. "Winterball" im Text
    // mit Präfix "WINTERBA" als unbekannter Code "LL…" gemeldet
    const pattern = new RegExp(`${normalizedPrefix}([2-9A-HJKMNP-Z]{${CODE_LENGTH}})`, 'g')
    const seen = new Set<string>()
    for (const record of records) {
      for (const match of record.normalized.matchAll(pattern)) {
        const code = normalizedPrefix + match[1]
        if (known.has(code) || seen.has(code)) continue
        seen.add(code)
        const suggestion = candidates.find(c => oneOff(normalizeForMatch(c.reference), code))?.reference ?? null
        unknownCodes.push({ code: `${prefix}-${match[1]}`, suggestion })
      }
    }
  }
  return { records: records.length, matches, unknownCodes }
}
