// app/ui/lost-found-banner.tsx
// Hinweis auf die Fundsachen nach einem Termin (Event.lostFoundUrl, Idee L36) - wann er erscheint, entscheidet
// lostFoundVisible (app/lib/photo-link.ts) auf der jeweiligen Seite.
export default function LostFoundBanner({ url, className = '' }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="lost-found-banner"
      className={`block rounded-lg border border-gray-200 bg-white px-4 py-3 text-center font-medium text-gray-800 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 ${className}`}
    >
      Etwas liegen gelassen? Zu den Fundsachen
    </a>
  )
}
