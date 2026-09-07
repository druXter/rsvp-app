// app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RSVP Event Management',
    short_name: 'RSVP',
    description: 'RSVP-Verwaltung für Events und Veranstaltungsreihen',
    start_url: '/admin',
    display: 'standalone',
    background_color: '#f3f4f6',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
