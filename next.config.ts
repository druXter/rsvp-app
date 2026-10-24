import type { NextConfig } from "next";

const NO_FRAMING = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];
const NOT_STORED = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-store' },
];
const PRIVATE_PAGE = [...NO_FRAMING, ...NOT_STORED];
// Für mehr Sicherheit lässt sich '*' durch die Adresse des CMS ersetzen.
const EMBEDDABLE = [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }];

// Mehrteilige Gästeseiten, die einbettbar bleiben: /reihe/<reihe>, /reihe/<reihe>/<termin> (auch .../registrieren)
// und /<event>/registrieren.
const EMBEDDABLE_DEEP = 'reihe/[^/]+/?$|reihe/[^/]+/[^/]+/?$|[^/]+/registrieren/?$';
// Einteilige Seiten des Tools selbst - sie passen auf "/:slug", sind aber keine Event-Seiten. Neue einteilige
// Routen hier ergänzen (tests/e2e/headers.spec.ts prüft die Header).
const OWN_PAGES = 'admin|mein-konto|verify|impressum|datenschutz|reihe|api|sw\\.js|manifest\\.webmanifest|icon\\.svg|favicon\\.ico';

const nextConfig: NextConfig = {
  // Erlaubt den Zugriff auf den Dev-Server über die LAN-IP des Servers (z.B. beim
  // Testen von einem anderen Gerät im Heimnetz). Ohne das blockiert Next.js im
  // Dev-Modus interne Client-Ressourcen cross-origin, wodurch Formulare mit
  // Client-seitigem onSubmit (RSVP-Formular, PIN-Formular) nie hydratisieren und
  // stattdessen auf natives, funktionsloses HTML-Formularverhalten zurückfallen.
  // Betrifft nur `next dev` - für Produktion (Docker) ohne Wirkung.
  allowedDevOrigins: ['192.168.178.126'],
  // Kontoauszug-Import (app/admin/zahlungen/[eventId]) schickt die Datei per Server Action. Standard ist 1 MB,
  // die Datei darf bis 1,5 MB groß sein (BANK_IMPORT_MAX_BYTES), dazu kommt der Overhead von multipart.
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    // Bei mehreren passenden Regeln gewinnt für denselben Header die SPÄTERE - die Reihenfolge
    // unten ist also wichtig. Muster wie in den anderen Tools der Suite (suite-kit/docs/KONVENTIONEN.md,
    // "Sicherheits-Header"): Einbetten ist grundsätzlich verboten, erlaubt nur für die Gästeseiten.
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
      // Startseite und alles Mehrteilige: nicht einbettbar - außer den Gästeseiten einer Reihe und den
      // Registrierungen (die eingebettete Event-Seite verlinkt im selben Frame dorthin).
      { source: '/', headers: NO_FRAMING },
      { source: `/:path((?!${EMBEDDABLE_DEEP})[^/]+/.+)`, headers: NO_FRAMING },
      { source: `/:path(${EMBEDDABLE_DEEP})`, headers: EMBEDDABLE },
      // Event-Seiten (erste Ebene) BEWUSST einbettbar: sie werden als iFrame in ein CMS eingebunden. Passt
      // auch auf /admin, /verify usw. - die nimmt die nächste Regel wieder aus.
      { source: '/:slug', headers: EMBEDDABLE },
      { source: `/:page(${OWN_PAGES})`, headers: NO_FRAMING },
      // Login, Konto und Verwaltung: nicht einbetten, nicht indexieren, nicht cachen.
      { source: '/:area(admin|mein-konto)', headers: PRIVATE_PAGE },
      { source: '/:area(admin|mein-konto)/:path*', headers: PRIVATE_PAGE },
      {
        // Seiten mit Einmal-Token in der URL (Mail-Links): den Token nie per Referer weitergeben.
        source: '/:page(verify|admin/reset-password|admin/confirm-email|mein-konto/reset-password|mein-konto/verify|mein-konto/confirm-email)',
        headers: [...NOT_STORED, { key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        // Der Service Worker darf nie aus einem Cache kommen (Browser, Cloudflare), sonst blieben Geräte auf einer
        // alten Version hängen. Eigene CSP: er lädt nur Skripte derselben Herkunft. Wie in den anderen Tools.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
        ],
      },
      {
        // Die Föderations-Endpunkte tragen Einmal-Werte (Login-Bestätigung, state) in der URL:
        // nie per Referer weiterreichen.
        source: '/api/suite/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        // Verknüpfte Tools (app/lib/linked-tools.ts): Seatings Gästeliste/Platzierungen (Server zu
        // Server), die Weiterleitungen "Sitzplatz wählen", "Zeitplan", "Feedback geben" bzw. "Zur Sitzung" (editToken in der URL,
        // signierter Link im Ziel), die Anwesenheit für Sitzungen und das Protokoll für den Zeitplan-Rückblick - nie cachen, nie per Referer weiterreichen.
        source: '/api/:area(seating|seating-link|timeline|timeline-link|feedback-link|assembly-link|assembly)/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
