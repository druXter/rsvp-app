// app/lib/csv.ts
//
// Ein Format für alle CSV-Exporte (Gästeliste, Küche, Anwesenheit): Semikolon, jede Zelle in Anführungszeichen, BOM
// für Excel. Zellen, die eine Tabellenkalkulation als Formel lesen würde, bekommen ein vorangestelltes Hochkomma -
// Namen, Antworten und Notizen tippen Gäste selbst ein, und `=HYPERLINK(...)` in einer Zelle wäre sonst ein Angriff
// auf die Person, die die Liste öffnet (CSV-Injection). Auch Tab und Zeilenumbruch am Anfang zählen dazu.

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${(FORMULA_START.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
}

export function csvContent(rows: readonly (readonly unknown[])[]): string {
  return '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\n')
}

export function csvResponse(rows: readonly (readonly unknown[])[], filename: string): Response {
  return new Response(csvContent(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store'
    }
  })
}
