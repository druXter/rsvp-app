// app/ui/poll-result-banner.tsx

/**
 * Zeigt das Ergebnis einer verknüpften Abstimmung (Event.pollResult, siehe
 * app/api/poll-result-webhook/route.ts), sobald eines vorliegt - rein additiv neben
 * dem bestehenden pollUrl-Link, ändert an dessen Verhalten nichts. `pollResult` ist
 * der rohe JSON-String aus der DB; ein ungültiger/fehlender Wert rendert einfach
 * nichts (kein Fehler), da das Feld jederzeit noch nie gesetzt worden sein kann.
 */
export default function PollResultBanner({ pollResult }: { pollResult: string | null }) {
  if (!pollResult) return null

  // quorumMet/unit fehlen bei Ergebnissen, die vor ihrer Einführung gespeichert wurden (siehe verifyResultWebhookPayload).
  let parsed: { pollTitle: string; winners: { label: string; votes: number }[]; closedAt: string; quorumMet?: boolean; unit?: 'votes' | 'points' }
  try {
    parsed = JSON.parse(pollResult)
  } catch {
    return null
  }

  const { winners } = parsed
  if (!Array.isArray(winners)) return null

  return (
    <div className="mb-4 text-center bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-3 px-4 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800">
      <p className="font-medium">
        🏆 Ergebnis der Abstimmung &quot;{parsed.pollTitle}&quot;:
      </p>
      {parsed.quorumMet === false ? (
        <p className="text-sm mt-1">Nicht beschlussfähig - die Mindestbeteiligung wurde nicht erreicht.</p>
      ) : winners.length === 0 ? (
        <p className="text-sm mt-1">Es wurde keine Stimme abgegeben.</p>
      ) : (
        <p className="text-sm mt-1">
          {winners.map(w => parsed.unit === 'points'
            ? `${w.label} (${w.votes} Punkt${w.votes === 1 ? '' : 'e'})`
            : `${w.label} (${w.votes} Stimme${w.votes === 1 ? '' : 'n'})`).join(' · ')}
          {winners.length > 1 ? ' — Gleichstand' : ''}
        </p>
      )}
    </div>
  )
}
