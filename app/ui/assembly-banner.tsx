// app/ui/assembly-banner.tsx
import { assemblyRoute } from '../lib/assembly'

/**
 * "Zur Sitzung" (Idee L7, app/lib/assembly.ts): führt über /api/assembly-link/[eventId] zur Sitzung im Abstimmungstool
 * (abstimmen, Rednerliste). Wann er erscheint, entscheidet assemblyLinkVisible; die Route prüft trotzdem selbst. Ein
 * normales <a> (Weiterleitung auf eine fremde Domain). Farbe cyan = Abstimmungstool.
 */
export default function AssemblyBanner({ eventId, editToken, className = '' }: { eventId: string; editToken?: string | null; className?: string }) {
  return (
    <a
      href={assemblyRoute(eventId, editToken)}
      rel="noreferrer"
      className={`block text-center bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-3 px-4 font-medium hover:bg-cyan-100 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800 dark:hover:bg-cyan-900 transition ${className}`}
    >
      🗳️ Zur Sitzung - abstimmen und Wortmeldungen
    </a>
  )
}
