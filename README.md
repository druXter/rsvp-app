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
```

> **Impressum-Platzhalter:** Die Impressum-Seite (`app/impressum/page.tsx`) liest ihre Angaben zur Laufzeit aus `IMPRESSUM_NAME`/`IMPRESSUM_STREET`/`IMPRESSUM_ZIP`/`IMPRESSUM_CITY`/`IMPRESSUM_EMAIL`/`IMPRESSUM_PHONE`. Sind diese Variablen nicht gesetzt, zeigt die Seite generische Platzhalter (`[Dein Vorname] [Dein Nachname]` etc.) statt echter Daten an. So bleibt das Repository frei von personenbezogenen Daten - trag deine echten Angaben ausschließlich in deine eigene, nicht versionierte `.env` ein (lokal wie auf dem Server).

> **VAPID-Keys generieren:** Für die Web-Push-Benachrichtigungen brauchst du ein eigenes Schlüsselpaar. Einmalig generieren mit:
> ```bash
> node -e "console.log(require('web-push').generateVAPIDKeys())"
> ```
> `VAPID_PUBLIC_KEY` ist unkritisch (wird an den Browser ausgeliefert), `VAPID_PRIVATE_KEY` ist ein Geheimnis wie `SMTP_PASS`. Sind die Keys nicht gesetzt, bleiben beide Push-Features (Admin-Dashboard und Gast-Seiten) einfach inaktiv (kein Push-Button sichtbar) - der Rest der App läuft unverändert weiter.

> **Erstes Benutzerkonto anlegen:** Es gibt keine öffentliche Registrierung. Dein allererstes Konto legst du einmalig per Skript an:
> ```bash
> node create-user.js deine-email@domain.de dein-passwort
> # oder im laufenden Docker-Container:
> docker compose run --rm rsvp-app node create-user.js deine-email@domain.de dein-passwort
> ```
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

## 🔒 Sicherheitshinweise

Die Datenbankdatei (`*.db`) und deine `.env`-Datei sind vom Tracking ausgeschlossen. Stelle sicher, dass du niemals echte Passwörter oder Nutzerdaten in das Git-Repository hochlädst.

## 🇪🇺 Datenschutz (DSGVO)

Die Datenschutzerklärung (`/datenschutz`) liest wie das Impressum ihre Angaben zur Laufzeit aus deiner `.env` (Verantwortlicher, E-Mail-Server) - trag deine echten Daten dort ein, im Repository bleiben nur Platzhalter. Gäste können ihre eigenen Daten jederzeit selbst vollständig löschen: über ihren persönlichen Bearbeitungslink ("Meine Daten vollständig löschen") bzw. über ihr Nutzer-Konto unter "Mein Konto" ("Konto & alle Daten unwiderruflich löschen"). Das Formular weist außerdem sichtbar auf eine aktive öffentliche Gästeliste hin, bevor eine Zusage abgeschickt wird, und erklärt bei Allergien/Essenswünschen kurz die Einwilligungsgrundlage.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.