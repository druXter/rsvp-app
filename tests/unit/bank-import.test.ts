import { describe, expect, it } from 'vitest'
import { amountsIn, decodeStatement, matchStatement, normalizeForMatch, splitRecords } from '../../app/lib/bank-import'

// Kontoauszug-Import: formatunabhängig, jede Buchung wird als Text nach den Verwendungszwecken durchsucht.

const SPARKASSE = [
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
  '"DE89370400440532013000";"10.10.26";"10.10.26";"GUTSCHR. UEBERWEISUNG";"WINTERBA-7KQ3M2XZ";"Paula Müller";"DE02120300000000202051";"BYLADEM1001";"25,00";"EUR";"Umsatz gebucht"',
  // Bindestrich weggelassen, klein geschrieben, falscher Betrag
  '"DE89370400440532013000";"11.10.26";"11.10.26";"GUTSCHR. UEBERWEISUNG";"Ticket winterba 9abc2def";"Otto";"DE02120300000000202051";"BYLADEM1001";"20,00";"EUR";""',
  // Verwendungszweck über zwei Zeilen umbrochen (im Feld), Tausender-Trennzeichen beim Betrag
  '"DE89370400440532013000";"12.10.26";"12.10.26";"GUTSCHR. UEBERWEISUNG";"Ball WINTERBA-HJK2\nMNP3 Danke";"Ulla";"DE02120300000000202051";"";"1.059,50";"EUR";""',
  // Tippfehler im Code (letztes Zeichen), außerdem "Winterball" ohne Code
  '"DE89370400440532013000";"13.10.26";"13.10.26";"GUTSCHR. UEBERWEISUNG";"WINTERBA-7KQ3M2XY Winterball";"Tim";"DE02120300000000202051";"";"25,00";"EUR";""',
  // Abbuchung (negativ) mit demselben Code - z. B. eine Erstattung
  '"DE89370400440532013000";"14.10.26";"14.10.26";"UEBERWEISUNG";"Erstattung WINTERBA-HJK2MNP3";"Ulla";"DE02120300000000202051";"";"-1.059,50";"EUR";""'
].join('\r\n')

const candidates = [
  { rsvpId: 'paula', reference: 'WINTERBA-7KQ3M2XZ', amountCents: 2500 },
  { rsvpId: 'otto', reference: 'WINTERBA-9ABC2DEF', amountCents: 2500 },
  { rsvpId: 'ulla', reference: 'WINTERBA-HJK2MNP3', amountCents: 105950 },
  { rsvpId: 'niemand', reference: 'WINTERBA-QQQQQQQQ', amountCents: 2500 }
]

describe('Kontoauszug lesen', () => {
  it('UTF-8 mit BOM und Windows-1252 (ANSI-Export)', () => {
    expect(decodeStatement(new TextEncoder().encode('﻿Müller'))).toBe('Müller')
    expect(decodeStatement(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Müller')
  })

  it('CSV: eine Buchung je Zeile, Umbrüche in Anführungszeichen bleiben im Feld', () => {
    const records = splitRecords(SPARKASSE)
    expect(records).toHaveLength(6)
    expect(records[3]).toContain('HJK2\nMNP3')
  })

  it('CAMT.053: je Einzelumsatz', () => {
    const xml = '<Document><Stmt><Ntry><Amt Ccy="EUR">25.00</Amt><NtryDtls><TxDtls><RmtInf><Ustrd>WINTERBA-7KQ3M2XZ</Ustrd></RmtInf></TxDtls>' +
      '<TxDtls><Amt Ccy="EUR">35.50</Amt><RmtInf><Ustrd>andere Zahlung</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></Document>'
    expect(splitRecords(xml)).toHaveLength(2)
  })

  it('Beträge: deutsch, englisch, negativ - Datumsangaben und IBANs zählen nicht', () => {
    expect(amountsIn('"10.10.26";"25,00";"EUR"')).toEqual([2500])
    expect(amountsIn('"1.059,50" und "-12,30"')).toEqual([105950, -1230])
    expect(amountsIn('<Amt Ccy="EUR">35.50</Amt> am 2026-10-10 bzw. 10.10.2026')).toEqual([3550])
    expect(amountsIn('DE89370400440532013000')).toEqual([])
    expect(normalizeForMatch('winterba-7kq3 m2xz')).toBe('WINTERBA7KQ3M2XZ')
  })
})

describe('matchStatement', () => {
  const result = matchStatement(SPARKASSE, candidates, 'WINTERBA')

  it('findet Verwendungszwecke trotz Schreibweise und Umbruch; prüft den Betrag', () => {
    expect(result.records).toBe(6)
    const byId = Object.fromEntries(result.matches.map(m => [m.rsvpId, m]))
    expect(Object.keys(byId).sort()).toEqual(['otto', 'paula', 'ulla'])
    expect(byId.paula).toMatchObject({ amountMatches: true, occurrences: 1 })
    expect(byId.otto).toMatchObject({ amountMatches: false, amountsFound: [2000] })
    // Gutschrift passt; die spätere Abbuchung zählt nur als weiteres Vorkommen
    expect(byId.ulla).toMatchObject({ amountMatches: true, occurrences: 2, amountsFound: [105950] })
  })

  it('meldet unbekannte Codes des Termins mit Vorschlag, aber kein "Winterball"', () => {
    expect(result.unknownCodes).toEqual([{ code: 'WINTERBA-7KQ3M2XY', suggestion: 'WINTERBA-7KQ3M2XZ' }])
  })

  it('ohne Treffer: leer', () => {
    expect(matchStatement('"x";"y"', candidates, 'WINTERBA')).toEqual({ records: 1, matches: [], unknownCodes: [] })
  })
})
