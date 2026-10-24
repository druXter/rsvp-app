import { describe, expect, it } from 'vitest'
import { csvCell, csvContent } from '../../app/lib/csv'

describe('csvCell', () => {
  it('entschärft alles, was als Formel gelesen würde', () => {
    for (const value of ['=HYPERLINK("https://evil")', '+49 151 1234', '-1+2', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(value), value).toBe(`"'${value.replace(/"/g, '""')}"`)
    }
  })

  it('lässt normale Werte unverändert und verdoppelt Anführungszeichen', () => {
    expect(csvCell('Anna "die Große"')).toBe('"Anna ""die Große"""')
    expect(csvCell('a=b')).toBe('"a=b"')
    expect(csvCell(3)).toBe('"3"')
    expect(csvCell(null)).toBe('""')
  })
})

describe('csvContent', () => {
  it('BOM, Semikolon, Zeilen mit \\n', () => {
    expect(csvContent([['Name', 'Wurst'], ['=1', 2]])).toBe('﻿"Name";"Wurst"\n"\'=1";"2"')
  })
})
