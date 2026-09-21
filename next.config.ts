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
    // Bei mehreren passenden Regeln gewinnt für denselben Header die SPÄTERE - die Reihenfolge
    // unten ist also wichtig: erst die allgemeinen, dann die Ausnahmen für sensible Bereiche.
    return [
      {
        // Für alle Seiten: keine MIME-Sniffing-Angriffe, sparsame Referer, HSTS nur für diesen Host
        // (ohne includeSubDomains, damit die anderen Subdomains der Suite davon unberührt bleiben).
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
      {
        // Gilt für alle Routen auf der ersten Ebene (deine Event-Slugs).
        // BEWUSST einbettbar: Event-Seiten werden als iFrame in ein CMS eingebunden.
        // Für mehr Sicherheit kannst du '*' durch die URL deines CMS ersetzen.
        source: '/:slug',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *;",
          },
        ],
      },
      {
        // Login, Konto und Verwaltung dürfen NICHT eingebettet werden (Clickjacking) - diese
        // Regel steht NACH der Event-Regel oben, weil "/admin" und "/mein-konto" selbst auch auf
        // "/:slug" passen und sonst "frame-ancestors *" bekämen.
        source: '/:area(admin|mein-konto)/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/:area(admin|mein-konto)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        // Die Föderations-Endpunkte tragen Einmal-Werte (Login-Bestätigung, state) in der URL:
        // nie einbetten, nie cachen, nie per Referer weiterreichen. Steht NACH der allgemeinen
        // Regel und überschreibt deren Referrer-Policy.
        source: '/api/suite/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
