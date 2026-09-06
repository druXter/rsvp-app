import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Erlaubt den Zugriff auf den Dev-Server über die LAN-IP des Servers (z.B. beim
  // Testen von einem anderen Gerät im Heimnetz). Ohne das blockiert Next.js im
  // Dev-Modus interne Client-Ressourcen cross-origin, wodurch Formulare mit
  // Client-seitigem onSubmit (RSVP-Formular, PIN-Formular) nie hydratisieren und
  // stattdessen auf natives, funktionsloses HTML-Formularverhalten zurückfallen.
  // Betrifft nur `next dev` - für Produktion (Docker) ohne Wirkung.
  allowedDevOrigins: ['192.168.178.126'],
  async headers() {
    return [
      {
        // Gilt für alle Routen auf der ersten Ebene (deine Event-Slugs)
        source: '/:slug',
        headers: [
          {
            key: 'Content-Security-Policy',
            // Erlaubt das Einbinden als iFrame auf allen Domains (*).
            // Für mehr Sicherheit kannst du '*' durch die URL deines CMS ersetzen.
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;