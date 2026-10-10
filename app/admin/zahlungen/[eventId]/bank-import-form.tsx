// app/admin/zahlungen/[eventId]/bank-import-form.tsx
'use client'

import { useActionState } from 'react'
import { confirmBankImport, previewBankImport, type BankImportState } from '../../actions'
import SubmitButton from '../../../ui/submit-button'

/**
 * Zwei Schritte: Datei hochladen -> Vorschau (previewBankImport, markiert nichts) -> Auswahl bestätigen
 * (confirmBankImport). Vorausgewählt sind nur offene Zahlungen, bei denen auch der Betrag passt.
 */
export default function BankImportForm({ eventId }: { eventId: string }) {
  const [state, upload, pending] = useActionState<BankImportState, FormData>(previewBankImport, null)
  const preview = state?.preview

  return (
    <div className="space-y-6">
      <form action={upload} className="space-y-3">
        <input type="hidden" name="eventId" value={eventId} />
        <label htmlFor="statement" className="block text-sm font-medium">Kontoauszug (CSV oder XML, höchstens 1,5 MB)</label>
        <input id="statement" name="statement" type="file" accept=".csv,.txt,.xml,text/csv,text/plain,application/xml,text/xml" required className="block w-full text-sm" />
        <SubmitButton>{pending ? 'Wird gelesen…' : 'Abgleichen'}</SubmitButton>
      </form>

      {state?.error && <p role="alert" className="text-sm bg-red-50 text-red-800 p-3 rounded border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{state.error}</p>}

      {preview && (
        <div className="space-y-4" data-testid="import-preview">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {state.fileName}: {preview.records} Buchungen gelesen, {preview.rows.length} Verwendungszweck(e) gefunden, {preview.openCount} Zahlung(en) insgesamt offen.
          </p>

          {preview.rows.length === 0 ? (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">Keine Verwendungszwecke dieses Termins im Auszug gefunden.</p>
          ) : (
            <form action={confirmBankImport} className="space-y-4">
              <input type="hidden" name="eventId" value={eventId} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-max">
                  <thead>
                    <tr className="border-b bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      <th className="p-2">Bezahlt</th><th className="p-2">Name</th><th className="p-2">Verwendungszweck</th><th className="p-2">Betrag</th><th className="p-2">Im Auszug</th><th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(row => (
                      <tr key={row.rsvpId} className="border-b last:border-0">
                        <td className="p-2">
                          <input type="checkbox" name="rsvpId" value={row.rsvpId} defaultChecked={row.selectable && row.amountMatches} disabled={!row.selectable} aria-label={`${row.name} als bezahlt markieren`} className="w-4 h-4" />
                        </td>
                        <td className="p-2 font-medium">{row.name}{row.categoryLabel && <span className="text-gray-500 dark:text-gray-400 font-normal"> · {row.categoryLabel}</span>}</td>
                        <td className="p-2 font-mono text-xs">{row.reference}</td>
                        <td className="p-2">{row.amount}</td>
                        <td className="p-2">
                          {row.amountMatches
                            ? <span className="text-green-700 dark:text-green-400">✓ Betrag passt</span>
                            : <span className="text-amber-700 dark:text-amber-400">⚠️ Betrag abweichend{row.amountsFound.length > 0 ? ` (${row.amountsFound.join(', ')})` : ''}</span>}
                          {row.occurrences > 1 && <span className="block text-amber-700 dark:text-amber-400">⚠️ {row.occurrences} Buchungen - doppelt überwiesen?</span>}
                        </td>
                        <td className="p-2 text-gray-600 dark:text-gray-400">{row.stateLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Vorausgewählt sind offene Zahlungen mit passendem Betrag. Bei abweichendem Betrag bitte selbst prüfen; schon bezahlte Zusagen, Absagen und Warteliste lassen sich hier nicht markieren.</p>
              <SubmitButton>Ausgewählte als bezahlt markieren</SubmitButton>
            </form>
          )}

          {preview.unknownCodes.length > 0 && (
            <div className="text-sm bg-amber-50 text-amber-900 p-3 rounded border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800" data-testid="unknown-codes">
              <p className="font-medium">Verwendungszwecke dieses Termins, die zu keiner Zusage passen (Tippfehler?):</p>
              <ul className="list-disc ml-5 mt-1">
                {preview.unknownCodes.map(u => (
                  <li key={u.code}><span className="font-mono">{u.code}</span>{u.suggestion && <> - gemeint vielleicht <span className="font-mono">{u.suggestion}</span>? Dann in der Gästeliste von Hand markieren.</>}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
