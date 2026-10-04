// app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RSVP Event Management',
    short_name: 'RSVP',
    description: 'RSVP-Verwaltung für Events und Veranstaltungsreihen',
    // Ein einziges Manifest bedient sowohl Admin- als auch Gast-PWA-Installationen (siehe
    // #12) - start_url zeigt daher auf die neutrale Startseite, die zu beiden Bereichen
    // verlinkt, statt fest auf /admin.
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f4f6',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      // Android legt seine eigene Form über das Icon - ohne "maskable"-Variante bliebe um den
      // blauen Kreis ein Rand aus Hintergrund stehen. Diese Variante füllt die ganze Fläche,
      // das Motiv liegt in der Schutzzone (Quelle: public/icons/icon-maskable.svg).
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Erlaubt auf unterstützten Plattformen (z.B. Android/Chrome per Icon-Long-Press)
    // einen direkten Sprung in einen der beiden Bereiche, ohne erst über die neutrale
    // Startseite zu müssen - hilfreich für jemanden mit Konten in beiden Systemen
    // (z.B. Moderator UND Nutzer einer fremden Reihe, siehe Verwaltung/Mein-Konto
    // Wechsel-Link für denselben Anwendungsfall innerhalb der App).
    shortcuts: [
      {
        name: 'Verwaltung',
        short_name: 'Admin',
        url: '/admin',
        description: 'Events und Reihen verwalten',
      },
      {
        name: 'Mein Konto',
        short_name: 'Mein Konto',
        url: '/mein-konto',
        description: 'Deine Termine als Gast ansehen und beantworten',
      },
    ],
  }
}
