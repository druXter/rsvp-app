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
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
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
      ABSTIMMUNGSTOOL_BASE_URL: '',
      SEATING_SECRET: TEST_SEATING_SECRET,
      SEATING_BASE_URL: TEST_SEATING_BASE_URL,
      SUITE_SIGNING_KEY: '',
      SUITE_IDPS: '',
      SUITE_TRUSTED_APPS: '',
      TZ: 'Europe/Berlin'
    }
  }
})
