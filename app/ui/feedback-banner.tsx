// app/ui/feedback-banner.tsx
import { feedbackRoute } from '../lib/feedback-link'

/**
 * "Feedback geben" (Idee L8 Teil 2, app/lib/feedback-link.ts): führt über /api/feedback-link/[eventId] zum Fragebogen
 * im Abstimmungstool. Wann er erscheint, entscheidet feedbackLinkVisible auf der jeweiligen Seite; die Route prüft
 * trotzdem selbst. Ein normales <a>, kein <Link> (Weiterleitung auf eine fremde Domain). Farbe cyan = Abstimmungstool.
 */
export default function FeedbackBanner({ eventId, editToken, className = '' }: { eventId: string; editToken?: string | null; className?: string }) {
  return (
    <a
      href={feedbackRoute(eventId, editToken)}
      rel="noreferrer"
      className={`block text-center bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-3 px-4 font-medium hover:bg-cyan-100 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800 dark:hover:bg-cyan-900 transition ${className}`}
    >
      📝 Feedback geben - wie war&apos;s?
    </a>
  )
}
