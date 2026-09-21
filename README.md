# 🎉 RSVP Event Management System

Ein schlankes, anpassbares und leistungsstarkes Event-Management-System, gebaut mit Next.js, TypeScript und Prisma. Perfekt für alles – von der privaten Geburtstagsfeier bis hin zu großen Uni-Events.

## ✨ Features

* **Mehrere Benutzerkonten mit Rollen & geteiltem Zugriff:** Verschiedene Referate, Vereine oder Freunde können dasselbe Tool getrennt voneinander nutzen - jedes Creator-Konto sieht und verwaltet ausschließlich seine eigenen Events und Reihen. Es gibt keine offene Registrierung; neue Konten werden von bereits eingeloggten Nutzern über "+ Nutzer anlegen" erstellt. Drei Rollen: **Admin** (voller Zugriff auf alle Konten, einzige Rolle, die neue Creator- oder Admin-Konten anlegen darf, verwaltet alle Konten über "👥 Nutzerverwaltung" inkl. Rollenwechsel & Löschen - ausgenommen andere Admin-Konten), **Creator** (eigenständiges Konto mit eigenen Events/Reihen, kann Moderator-Konten anlegen), **Moderator** (kein eigenes Event, nur mit ihm/ihr geteilter Zugriff). Ein Creator kann einzelne Events oder ganze Reihen gezielt mit einem Moderator-Konto teilen (Check-in durchführen, Gäste-/Wartelisten einsehen & bearbeiten), ohne diesem vollen Zugriff auf das eigene Konto zu geben. Passwort vergessen? Creator- und Moderator-Konten können es sich selbst per E-Mail-Link zurücksetzen (`/admin/forgot-password`) - für Admin-Konten ist das bewusst nicht möglich, dort bleibt ein Reset nur über direkten Server-Zugriff (`set-role.js`/`create-user.js`) möglich. Jedes eingeloggte Konto (ausdrücklich auch Admins) kann sein Passwort und seine E-Mail-Adresse aber unter "⚙️ Konto-Einstellungen" selbst ändern, sofern es das aktuelle Passwort kennt - eine E-Mail-Änderung wird erst nach Bestätigung über einen an die neue Adresse geschickten Link wirksam.
* **Multi-Event-Support:** Verwalte beliebig viele Events gleichzeitig über dynamische URLs (z.B. `/sommerfest`).
* **Veranstaltungsreihen:** Optional mehrere Termine zu einer Reihe bündeln (z.B. ein wöchentlicher Stammtisch). Kontaktdaten, Essenswunsch und Allergien werden dabei nur einmal pro Person abgefragt und automatisch für jeden weiteren Termin der Reihe übernommen; Zusage, Warteliste und der Rest der Antwort bleiben pro Termin individuell. Eigene Übersichtsseite je Reihe (`/reihe/[slug]`), reihenweite PIN und Gästeliste. Einzel-Events bleiben davon komplett unberührt und sind weiterhin der Standardfall.
* **Nutzer-Konten für Stammgäste (optional, PWA-fähig):** Gäste einer Reihe können sich unter `/reihe/[slug]/registrieren` selbst ein Login-Konto anlegen (E-Mail-Bestätigung erforderlich) und sich danach unter `/mein-konto` einloggen - dort sehen sie automatisch alle Termine jeder ihnen zugeordneten Reihe samt Antwortstatus, ganz ohne sich Links merken zu müssen. Kontaktdaten, Essenswunsch und Allergien werden zentral am Konto gepflegt und gelten sofort für alle Reihen. Ein solches Konto kann mehreren Reihen zugeordnet sein (z.B. Stammtisch UND Kino-Abend) - ein Creator/Moderator kann ein bestehendes Konto jederzeit einer weiteren Reihe hinzufügen, ohne dass sich der Gast neu registrieren müsste. Passwort vergessen? Geht auch hier selbst per E-Mail-Link (`/mein-konto/forgot-password`), unabhängig vom Admin-Passwort-Reset. Direkt im Konto (mit aktuellem Passwort) lassen sich Passwort und E-Mail-Adresse ebenfalls jederzeit selbst ändern. Wer beide Konten hat (z.B. ein Moderator, der bei einer fremden Reihe auch ganz normal als Nutzer teilnimmt), bekommt nach dem Login in beiden Bereichen einen direkten Wechsel-Link zum jeweils anderen - praktisch v.a. in der installierten PWA, die als App-Verknüpfung zusätzlich direkte Shortcuts zu "Admin-Dashboard" und "Mein Konto" anbietet.
* **Gruppen- & Vereins-Features:**
  * **Transparente Gästeliste:** Optional zuschaltbare öffentliche Gästeliste, auf der Teilnehmer sehen können, wer zugesagt hat, wer Begleitungen mitbringt und wer welches Essen/Getränk beisteuert. Sensible Daten (E-Mail, Telefon) werden streng gefiltert.
  * **Event-PIN:** Schütze private Events mit einem Zugangscode vor unbefugten Aufrufen.
* **Kapazitätsgrenzen & intelligente Warteliste:**
  * Optionale maximale Teilnehmerzahl pro Event festlegbar.
  * Vollautomatische Warteliste: Sobald das Limit erreicht ist, reihen sich neue Gäste nahtlos in die Warteschlange ein (inkl. Wartelisten-Info per E-Mail).
  * Auto-Nachrücken: Sagt ein Gast ab oder erhöht der Admin die Kapazität, rücken wartende Gäste automatisch chronologisch nach und erhalten ihr Ticket per Mail.
  * Admin-Override: Manuelles Zulassen von Gästen ("VIPs") an der Warteliste und Kapazitätsgrenze vorbei.
* **Dynamische Formulare:** Bestimme pro Event, welche Felder deine Gäste ausfüllen sollen:
  * Begleitperson (+1) inkl. Name
  * Essenspräferenzen (Vegan, Vegetarisch, Allesesser) & Allergien
  * Alkohol-Präferenz
  * Mitbringsel (Essen/Trinken)
  * E-Mail und Handynummer
* **Freie Zusatzfragen:** Bis zu 3 frei definierbare Textfragen pro Event/Termin (z.B. "Welchen Song wünschst du dir vom DJ?"), die dynamisch im Gästeformular erscheinen. Antworten landen in der Admin-Gästetabelle und im CSV-Export.
* **Double-Opt-In (Verifizierung):** Optional zuschaltbare E-Mail-Bestätigung für Gäste, um Spam-Anmeldungen zu verhindern und korrekte Adressen sicherzustellen.
* **Automatischer E-Mail-Versand:** Gäste erhalten nach der Zusage eine automatische Bestätigungsmail inkl. iCal-Datei und personalisiertem Link zur nachträglichen Bearbeitung.
* **Erinnerungs-Mails (Reminders):** 
  * Manueller Versand aus dem Dashboard an alle Zusagen (inkl. optionaler Zusatzinfos für die Gäste).
  * Vollautomatischer Versand X Tage vor dem Event (gesicherter Endpoint für Uptime Kuma oder Cronjobs).
* **QR-Code Einlasskontrolle (optional, standardmäßig aus):** Pro Event/Termin zuschaltbar für Veranstaltungen mit echtem Einlass. Bestätigte Gäste bekommen einen persönlichen QR-Code (Bestätigungsmail & Erfolgsseite), der beim Scannen automatisch als "anwesend" markiert wird. Das Admin-Dashboard zeigt eine Live-Statistik ("🎫 Eingecheckt: 25/50") und erlaubt auch manuelles Ein-/Auschecken ohne Scan. Für die meisten privaten Feiern ohne Einlasskontrolle bleibt diese Option einfach deaktiviert.
* **Web-Push-Benachrichtigungen (PWA):** Sowohl das Admin-Dashboard als auch die Gast-Seiten sind als installierbare PWA konfiguriert. Admins können sich pro Gerät anmelden und werden sofort informiert, sobald ein Gast eine neue Zu- oder Absage abgibt. Gäste können sich direkt auf ihrer Antwort-Seite ("🔕 Push-Benachrichtigungen aktivieren"-Button) anmelden - ganz ohne eigenes Konto - und bekommen dann Erinnerungen sowie kurzfristige Termin-Änderungen (Uhrzeit/Ort/Titel/Beschreibung) auch als Push, nicht nur per Mail.
* **Admin Dashboard:** 
  * Volle Übersicht über alle Zu- und Absagen sowie Wartelistenplätze.
  * Status-Anzeige ausstehender E-Mail-Verifizierungen.
  * Nachträgliches, manuelles Bearbeiten von Gästedaten (z.B. bei telefonischer Zusage).
  * CSV-Export der kompletten Gästeliste mit einem Klick.
  * Geschützt durch individuelle Benutzerkonten (E-Mail + Passwort).

## 🛠 Tech Stack

* **Frontend & Backend:** Next.js (App Router, Server Actions)
* **Sprache:** TypeScript
* **Datenbank:** SQLite mit Prisma ORM
* **Styling:** Tailwind CSS
* **Deployment:** Docker & Docker Compose (optimiert für Alpine)

## 🚀 Quick Start (Local & Docker)

### 1. Repository klonen
   
```bash
git clone <deine-repo-url>
cd rsvp-app
```

### 2. Umgebungsvariablen setzen
   
Kopiere die Vorlage und öffne sie:
   
```bash
cp .env.example .env
```
   
Konfiguriere den automatischen E-Mail-Versand:
   
```env
# E-Mail & URL Konfiguration für automatische Bestätigungen
BASE_URL=[https://rsvp.deine-domain.de](https://rsvp.deine-domain.de)

SMTP_HOST=smtp.dein-provider.de
SMTP_PORT=587
SMTP_USER=deine-email@domain.de
SMTP_PASS=dein-mail-passwort
SMTP_FROM="RSVP Team <deine-email@domain.de>"

# Sicherheitsschlüssel für den automatischen Cronjob-Versand (z.B. via Uptime Kuma)
CRON_SECRET=DeinSehrGeheimesPasswort123

# Angaben fürs Impressum (/impressum) - siehe Hinweis unten
IMPRESSUM_NAME=Vorname Nachname
IMPRESSUM_STREET=Musterstraße 1
IMPRESSUM_ZIP=12345
IMPRESSUM_CITY=Musterstadt
IMPRESSUM_EMAIL=deine-email@domain.de
IMPRESSUM_PHONE=Optional

# VAPID-Keys für Web-Push-Benachrichtigungen (Admin-Dashboard UND Gast-Seiten teilen sich
# dasselbe Schlüsselpaar) - siehe Hinweis unten
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:deine-email@domain.de

# Gemeinsames Secret mit dem separaten "abstimmungstool" (eigenständiges Projekt) -
# nur relevant, wenn ein Event/Termin einen Abstimmungs-Link (pollUrl) hat. Ohne
# dieses Secret wird der Link trotzdem angezeigt, nur eben ohne automatische
# Übernahme der Nutzer-Verifizierung. MUSS exakt mit RSVP_VERIFICATION_SECRET in
# der .env des abstimmungstools übereinstimmen.
POLL_VERIFICATION_SECRET=...

# Basis-URL des abstimmungstools, damit diese App bei einer Zu-/Absage-Änderung
# aktiv Bescheid geben kann (siehe app/lib/poll-notify.ts) - nur relevant zusammen
# mit POLL_VERIFICATION_SECRET und einem gesetzten pollUrl.
ABSTIMMUNGSTOOL_BASE_URL=https://vote.deine-domain.de
```

> **Impressum-Platzhalter:** Die Impressum-Seite (`app/impressum/page.tsx`) liest ihre Angaben zur Laufzeit aus `IMPRESSUM_NAME`/`IMPRESSUM_STREET`/`IMPRESSUM_ZIP`/`IMPRESSUM_CITY`/`IMPRESSUM_EMAIL`/`IMPRESSUM_PHONE`. Sind diese Variablen nicht gesetzt, zeigt die Seite generische Platzhalter (`[Dein Vorname] [Dein Nachname]` etc.) statt echter Daten an. So bleibt das Repository frei von personenbezogenen Daten - trag deine echten Angaben ausschließlich in deine eigene, nicht versionierte `.env` ein (lokal wie auf dem Server).

> **VAPID-Keys generieren:** Für die Web-Push-Benachrichtigungen brauchst du ein eigenes Schlüsselpaar. Einmalig generieren mit:
> ```bash
> node -e "console.log(require('web-push').generateVAPIDKeys())"
> ```
> `VAPID_PUBLIC_KEY` ist unkritisch (wird an den Browser ausgeliefert), `VAPID_PRIVATE_KEY` ist ein Geheimnis wie `SMTP_PASS`. Sind die Keys nicht gesetzt, bleiben beide Push-Features (Admin-Dashboard und Gast-Seiten) einfach inaktiv (kein Push-Button sichtbar) - der Rest der App läuft unverändert weiter.

> **Erstes Benutzerkonto anlegen:** Es gibt keine öffentliche Registrierung. Dein allererstes Konto legst du einmalig per Skript an:
> ```bash
> node create-user.js deine-email@domain.de ADMIN
> # oder im laufenden Docker-Container:
> docker compose run --rm rsvp-app node create-user.js deine-email@domain.de ADMIN
> ```
> Das Passwort (mind. 10 Zeichen) wird verdeckt abgefragt, damit es weder im Shell-Verlauf noch in der Prozessliste landet. Die Rolle ist optional (Standard: Creator) - mit `ADMIN` entfällt der separate `set-role.js`-Schritt unten. Nicht-interaktiv geht auch `PASSWORD=... node create-user.js ...`.
> Danach kannst du dich unter `/admin/login` einloggen und über "+ Nutzer anlegen" im Dashboard weitere Konten für andere Referate/Freunde erstellen - `create-user.js` brauchst du dann nicht mehr.
>
> Dein allererstes Konto startet als **Creator**. Damit du im Dashboard Admin-Rechte hast (alle Konten sehen, neue Creator-Konten anlegen), beförderst du es einmalig zu **Admin**:
> ```bash
> node set-role.js deine-email@domain.de ADMIN
> # oder im laufenden Docker-Container:
> docker compose run --rm rsvp-app node set-role.js deine-email@domain.de ADMIN
> ```

### 3. Mit Docker starten (Empfohlen)
   
Baue und starte den Container:
   
```bash
docker compose up -d --build
```
   
Die App ist nun unter `http://localhost:3000` (bzw. auf deinem konfigurierten Port) erreichbar. Die SQLite-Datenbank wird automatisch migriert.

## ⏰ Automatische Erinnerungen (Cronjob / Uptime Kuma)

Um automatische E-Mail-Erinnerungen für Events zu versenden, muss der folgende Endpoint regelmäßig (z.B. stündlich) über einen Dienst wie Uptime Kuma aufgerufen werden. Das System prüft dann selbstständig, ob für ein anstehendes Event Mails verschickt werden müssen:

`GET https://rsvp.deine-domain.de/api/cron/reminders?secret=DeinSehrGeheimesPasswort123`

## 🗑️ Automatische Datenlöschung (Cronjob / Uptime Kuma)

Zur Umsetzung der Speicherbegrenzung nach DSGVO gibt es einen zweiten, unabhängigen Endpoint, der ebenfalls regelmäßig aufgerufen werden sollte (hier reicht z.B. einmal täglich statt stündlich). Er löscht automatisch Events (inkl. Datensatz) 18 Monate nach dem Veranstaltungsdatum sowie Nutzer-Konten ("Mein Konto"), die seit 2 Jahren nicht mehr eingeloggt wurden - siehe `/datenschutz` Punkt 10 für die genauen Regeln:

`GET https://rsvp.deine-domain.de/api/cron/cleanup?secret=DeinSehrGeheimesPasswort123`

## 🗳️ Verknüpfung mit dem separaten "abstimmungstool"

Ein Event/Termin kann optional auf eine Abstimmung im separaten `abstimmungstool`-Projekt verlinken (`Event.pollUrl`/`pollLabel`, gesetzt beim Anlegen/Bearbeiten). Ist dort zusätzlich `requireRsvpVerification` für diese Abstimmung aktiviert, greift eine tiefere Kopplung:

* **Nur Zusagende können abstimmen, Absagen werden direkt blockiert:** Der Verifizierungs-Token, der beim Klick auf den Abstimmungs-Link mitgeschickt wird, trägt neben der E-Mail auch den *aktuellen* RSVP-Status für diesen Termin (`app/lib/poll-verification.ts`, `app/api/poll-link/[eventId]/route.ts`) - bei jedem Klick frisch ermittelt. Eine nachträglich erteilte Zusage schaltet sich dadurch beim nächsten Linkaufruf von selbst wieder frei.
* **Nachträgliche Absage entfernt eine bereits abgegebene Stimme:** Bei jeder Zu-/Absage-Änderung wird zusätzlich aktiv ein signierter Webhook ans abstimmungstool geschickt (`app/lib/poll-notify.ts`, aufgerufen aus `performRsvpSubmission`) - unabhängig davon, ob die Person die Abstimmung danach nochmal aufruft. Best-effort mit 5s-Timeout, ein nicht erreichbares abstimmungstool blockiert niemals die eigentliche RSVP-Abgabe.
* **Ergebnis-Anzeige nach Schließung:** Schließt sich die verknüpfte Abstimmung (manuell oder automatisch), meldet abstimmungstool das Ergebnis zurück (`app/api/poll-result-webhook/route.ts`), gespeichert auf `Event.pollResult` und angezeigt als Banner auf der Event-Seite (`app/ui/poll-result-banner.tsx`).

Alle drei Punkte sind rein additiv und benötigen `POLL_VERIFICATION_SECRET` + `ABSTIMMUNGSTOOL_BASE_URL` (siehe oben) - ohne beide bleibt nur der einfache, unverifizierte Link übrig, wie er schon vorher existierte.

## 🔐 Konto-Sicherheit

Gilt für Admin-Konten (`/admin/login`) **und** Nutzer-Konten (`/mein-konto`):

* **Passwort-Regel:** mind. 10 Zeichen (höchstens 72 Byte, die bcrypt-Grenze), keine Zeichenklassen-Pflicht, aber
  Abgleich gegen naheliegende Fälle (E-Mail selbst, Klassiker). Wird serverseitig durchgesetzt (`app/lib/password.ts`),
  das HTML-`minLength` ist nur Komfort. Hashing bleibt bcrypt; neue Hashes bekommen Kosten 12, ältere werden beim
  nächsten Login automatisch erneuert.
* **Passwort-Raten:** Drosselung pro IP **und** pro Ziel-E-Mail (`app/lib/throttle.ts`): 10 Fehlversuche pro E-Mail bzw.
  20 pro IP in 15 Minuten, danach Sperre bis zum Ende des Zeitfensters - bewusst **keine** dauerhafte Kontosperre, sonst
  könnte jeder fremde Konten lahmlegen. Der Versuch wird VOR der Prüfung atomar reserviert, das Limit gilt also auch bei
  vielen gleichzeitigen Anfragen. Fehlermeldung und Antwortzeit sind für bekannte und unbekannte Adressen gleich (bei
  unbekannter Adresse rechnet eine gleich teure Prüfung gegen einen Wegwerf-Hash). Ebenfalls gedrosselt: Passwort-Reset-
  Anfragen, die öffentliche Registrierung (löst eine Mail an eine beliebige Adresse aus) und die Passwort-Abfrage bei
  "Passwort/E-Mail ändern". Gespeichert werden nur SHA-256-Hashes von IP/E-Mail.
* **`TRUST_PROXY_HOPS`** muss zur Umgebung passen (siehe `.env.example`): Nur so ist die IP für die Drosselung nicht durch
  einen selbst mitgeschickten `X-Forwarded-For`-Wert fälschbar. Beim Betreiber (Cloudflare → Nginx Proxy Manager)
  gemessen: `1`.
* **Sessions und Einmal-Links** (Reset, E-Mail-Änderung, Konto-Bestätigung) stehen in der Datenbank nur als SHA-256-Hash
  (`app/lib/tokens.ts`), der Klartext nur im Cookie bzw. Mail-Link. Beim ersten Start nach dem Update stellt
  `migrate-token-hashes.js` bestehende Tokens einmalig um (bereits verschickte Links funktionieren weiter) und beendet
  alle Sitzungen - alle müssen sich einmal neu anmelden.
* **Cookies** heißen `__Host-session` bzw. `__Host-guest-session` (HttpOnly, Secure, SameSite=Lax, ohne Domain-Attribut):
  Die Tools der Suite laufen auf Subdomains derselben Domain, so kann kein Tool einem anderen ein Cookie unterschieben.
* **Header** (`next.config.ts`): `nosniff`, `Referrer-Policy`, HSTS. **Event-Seiten bleiben bewusst einbettbar**
  (`frame-ancestors *`, sie laufen als iFrame in einem CMS), Login, Konto und Verwaltung (`/admin`, `/mein-konto`) und die
  Föderations-Endpunkte dagegen nicht (Clickjacking).
* **Cron-Endpunkte** (`/api/cron/*`) lehnen ein leeres oder fehlendes `CRON_SECRET` ab - vorher schaltete `?secret=`
  (leer) den Endpunkt bei einem leeren Platzhalter-Secret frei.

## 🔗 Konten-Verbund mit anderen Tools (optional)

Über das gemeinsame Paket [`suite-kit`](https://github.com/druXter/suite-kit) (Protokoll, Sicherheitsregeln und Format
dort im README) kann man sich mit Admin-Konten (nicht Nutzer-Konten) auch mit dem Konto eines anderen Tools der Suite
anmelden - z.B. dem Abstimmungstool - und umgekehrt. Es gibt **keinen zentralen Anbieter**: Jedes Tool ist zugleich
Anbieter und Empfänger, und jedes bleibt mit eigenen Konten vollständig allein nutzbar.

* **Konfiguration:** `SUITE_SIGNING_KEY` + `SUITE_TRUSTED_APPS` (Anbieter), `SUITE_IDPS` (Empfänger), siehe `.env.example`.
  Ohne sie keine Föderation, kein Button.
* **Kein Passwort-Austausch, kein gemeinsames Secret:** Bestätigungen sind mit Ed25519 signiert, der öffentliche Schlüssel
  steht unter `/.well-known/suite-identity`.
* **Identität** ist (Anbieter, Konto-ID) - nie die E-Mail. Kein automatisches Zusammenführen über die E-Mail: Gibt es hier
  schon ein Konto mit derselben Adresse, wird der Verbund-Login abgelehnt; man verknüpft bewusst unter
  "⚙️ Konto-Einstellungen" aus einer bestehenden Sitzung heraus.
* **Neue Konten per Verbund** (`autoProvision`) legt rsvp-app nur an, wenn der Anbieter so konfiguriert ist. Empfohlen bleibt
  `false`: Neue Creator-Konten soll hier nur ein Admin anlegen (siehe Rollenkonzept oben). Dann melden sich nur Konten an,
  die zuvor bewusst verknüpft wurden. Rollen gibt der Empfänger, nie der Anbieter (`mapAdminRole`, Standard: aus).
* Konten ohne Passwort (nur über ein anderes Tool angemeldet) können sich nicht per Passwort anmelden und bestätigen selbst
  keine Anmeldung für weitere Tools (keine Ketten).

## 🔒 Sicherheitshinweise

Die Datenbankdatei (`*.db`) und deine `.env`-Datei sind vom Tracking ausgeschlossen. Stelle sicher, dass du niemals echte Passwörter oder Nutzerdaten in das Git-Repository hochlädst.

## 🇪🇺 Datenschutz (DSGVO)

Die Datenschutzerklärung (`/datenschutz`) liest wie das Impressum ihre Angaben zur Laufzeit aus deiner `.env` (Verantwortlicher, E-Mail-Server) - trag deine echten Daten dort ein, im Repository bleiben nur Platzhalter. Gäste können ihre eigenen Daten jederzeit selbst vollständig löschen: über ihren persönlichen Bearbeitungslink ("Meine Daten vollständig löschen") bzw. über ihr Nutzer-Konto unter "Mein Konto" ("Konto & alle Daten unwiderruflich löschen"). Das Formular weist außerdem sichtbar auf eine aktive öffentliche Gästeliste hin, bevor eine Zusage abgeschickt wird, und erklärt bei Allergien/Essenswünschen kurz die Einwilligungsgrundlage.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.