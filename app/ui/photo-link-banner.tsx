// app/ui/photo-link-banner.tsx
// Hinweis auf das Fotoalbum eines Termins (Event.photoUrl, app/lib/photo-link.ts) - wann er erscheint,
// entscheidet photoLinkVisible auf der jeweiligen Seite.
export default function PhotoLinkBanner({ url, className = '' }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block text-center bg-rose-50 text-rose-800 border border-rose-200 rounded-lg py-3 px-4 font-medium hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 dark:hover:bg-rose-900 transition ${className}`}
    >
      📷 Fotos ansehen und eigene hochladen
    </a>
  )
}
