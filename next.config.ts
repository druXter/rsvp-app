import type { NextConfig } from "next";
import { BASE_RULE, EMBEDDABLE, NO_FRAMING, NO_REFERRER, NOT_STORED, PRIVATE_PAGE, SUITE_RULES } from "suite-kit/web";

// Header-Bausteine aus suite-kit (docs/KONVENTIONEN.md, "Sicherheits-Header"); hier stehen nur die Pfade dieses Tools.
// Für mehr Sicherheit lässt sich EMBEDDABLE (frame-ancestors *) durch eine Regel mit der Adresse des CMS ersetzen.

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
      BASE_RULE,
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
        headers: [...NOT_STORED, ...NO_REFERRER],
      },
      {
        // Verknüpfte Tools (app/lib/linked-tools.ts): Seatings Gästeliste/Platzierungen (Server zu
        // Server), die Weiterleitungen "Sitzplatz wählen", "Zeitplan", "Feedback geben" bzw. "Zur Sitzung" (editToken in der URL,
        // signierter Link im Ziel), die Anwesenheit für Sitzungen und das Protokoll für den Zeitplan-Rückblick - nie cachen, nie per Referer weiterreichen.
        source: '/api/:area(seating|seating-link|timeline|timeline-link|feedback-link|assembly-link|assembly)/:path*',
        headers: [...NO_REFERRER, { key: 'Cache-Control', value: 'no-store' }],
      },
      // Service Worker (nie cachen, eigene CSP) und Föderations-Endpunkte (kein Referer) - zuletzt, damit sie gewinnen.
      ...SUITE_RULES,
    ];
  },
};

export default nextConfig;
