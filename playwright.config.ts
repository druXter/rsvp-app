import { defineConfig, devices } from '@playwright/test'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden, eine parallel laufende
// Entwicklungsinstanz (localhost:3000) oder ein anderes Tool der Suite auf localhost würde
// sonst dieselben Cookies sehen.
const PORT = 3105
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const TEST_CRON_SECRET = 'e2e-cron-secret'
// Gemeinsames HMAC-Geheimnis mit dem Abstimmungstool (POLL_VERIFICATION_SECRET) - hier ein
// reiner Testwert, damit die Tests Ergebnis-Meldungen signieren und Klick-Tokens prüfen können.
export const TEST_POLL_SECRET = 'e2e-poll-verification-secret'
// Kopplung mit Seating (app/lib/seating.ts): eigenes Secret (mind. 32 Zeichen, nie das
// Abstimmungs-Secret) und ein Origin, unter dem tests/e2e/seating.spec.ts ein kleines
// Schein-Seating startet, das die Webhooks mitschreibt.
export const TEST_SEATING_SECRET = 'e2e-seating-secret-0123456789abcdef0123'
export const SEATING_PORT = 3106
export const TEST_SEATING_BASE_URL = `http://127.0.0.1:${SEATING_PORT}`
// Kopplung mit dem Zeitplan-Tool (app/lib/timeline.ts): wieder ein EIGENES Secret und ein Origin,
// unter dem tests/e2e/timeline.spec.ts ein Schein-Zeitplan startet.
export const TEST_TIMELINE_SECRET = 'e2e-timeline-secret-0123456789abcdef012'
export const TIMELINE_PORT = 3107
export const TEST_TIMELINE_BASE_URL = `http://127.0.0.1:${TIMELINE_PORT}`
// Origin des Abstimmungstools für die Terminabstimmung (app/lib/poll-date.ts): Dort läuft in den
// Tests nichts - rsvp-app prüft nur, ob eine pollUrl zu diesem Origin gehört. Ausgehende
// Zu-/Absage-Meldungen dorthin scheitern sofort (best-effort, siehe app/lib/poll-notify.ts).
export const TEST_ABSTIMMUNGSTOOL_BASE_URL = 'http://127.0.0.1:3108'
// Ein Origin, der zu keinem eingerichteten Tool gehört - für die Fälle "fremde Adresse".
export const FOREIGN_TOOL_BASE_URL = 'http://127.0.0.1:3199'

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'

export default defineConfig({
  testDir: './tests/e2e',
  // Alle Tests teilen sich eine Datenbank und die Drossel-Zähler - nacheinander ausführen.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    locale: 'de-DE'
  },
  webServer: {
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), wie im Container migrieren, dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && node migrate-token-hashes.js && node migrate-tool-links.js && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Next.js liest zusätzlich die lokale .env - bereits gesetzte Variablen (auch leere) überschreibt
    // sie aber nicht. Alles, was nach außen wirken würde (Mailversand, Push, Meldungen ans
    // Abstimmungstool, Konten-Verbund), wird deshalb hier ausdrücklich abgeschaltet.
    env: {
      DATABASE_URL: 'file:./test.db',
      BASE_URL,
      // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, um verschiedene
      // Besucher-IPs zu simulieren.
      TRUST_PROXY_HOPS: '1',
      CRON_SECRET: TEST_CRON_SECRET,
      // Kein Mailversand: Reset-/Bestätigungs-Mails gehen nirgendwohin (die Tests lesen Tokens
      // aus der Datenbank bzw. legen sie dort selbst an).
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      POLL_VERIFICATION_SECRET: TEST_POLL_SECRET,
      ABSTIMMUNGSTOOL_BASE_URL: TEST_ABSTIMMUNGSTOOL_BASE_URL,
      SEATING_SECRET: TEST_SEATING_SECRET,
      SEATING_BASE_URL: TEST_SEATING_BASE_URL,
      TIMELINE_SECRET: TEST_TIMELINE_SECRET,
      TIMELINE_BASE_URL: TEST_TIMELINE_BASE_URL,
      SUITE_SIGNING_KEY: '',
      SUITE_IDPS: '',
      SUITE_TRUSTED_APPS: '',
      TZ: 'Europe/Berlin'
    }
  }
})
