# 🎉 RSVP Event Management System

Ein schlankes, anpassbares und leistungsstarkes Event-Management-System, gebaut mit Next.js, TypeScript und Prisma. Perfekt für alles – von der privaten Geburtstagsfeier bis hin zu großen Uni-Events.

## ✨ Features

* **Multi-Event-Support:** Verwalte beliebig viele Events gleichzeitig über dynamische URLs (z.B. `/sommerfest`).
* **Dynamische Formulare:** Bestimme pro Event, welche Felder deine Gäste ausfüllen sollen:
  * Begleitperson (+1) inkl. Name
  * Essenspräferenzen (Vegan, Vegetarisch, Allesesser) & Allergien
  * Alkohol-Präferenz
  * Mitbringsel (Essen/Trinken)
  * E-Mail und Handynummer
* **Automatischer E-Mail-Versand:** Gäste erhalten nach der Zusage eine automatische Bestätigungsmail inkl. iCal-Datei und personalisiertem Link zur nachträglichen Bearbeitung.
* **Erinnerungs-Mails (Reminders):** 
  * Manueller Versand aus dem Dashboard an alle Zusagen (inkl. optionaler Zusatzinfos für die Gäste).
  * Vollautomatischer Versand X Tage vor dem Event (gesicherter Endpoint für Uptime Kuma oder Cronjobs).
* **Admin Dashboard:** 
  * Volle Übersicht über alle Zu- und Absagen.
  * Nachträgliches, manuelles Bearbeiten von Gästedaten (z.B. bei telefonischer Zusage).
  * CSV-Export der kompletten Gästeliste mit einem Klick.
  * Geschützt durch ein Master-Passwort.

## 🛠 Tech Stack

* **Frontend & Backend:** Next.js (App Router, Server Actions)
* **Sprache:** TypeScript
* **Datenbank:** SQLite mit Prisma ORM
* **Styling:** Tailwind CSS
* **Deployment:** Docker & Docker Compose

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
   
Trage in der `.env` dein gewünschtes sicheres `ADMIN_PASSWORD` ein und konfiguriere den automatischen E-Mail-Versand:
   
```env
DATABASE_URL="file:./dev.db"

ADMIN_PASSWORD=hier_dein_passwort_eintragen

# E-Mail & URL Konfiguration
BASE_URL=https://domain.de

SMTP_HOST=smtp.dein-provider.de
SMTP_PORT=587
SMTP_USER=deine-email@domain.de
SMTP_PASS=dein-mail-passwort
SMTP_FROM="RSVP Team <deine-email@domain.de>"

CRON_SECRET=hier_cron_secret_eintragen
```

### 3. Mit Docker starten (Empfohlen)
   
Baue und starte den Container:
   
```bash
docker compose up -d --build
```
   
Die App ist nun unter `http://localhost:3000` (bzw. auf deinem konfigurierten Port) erreichbar. Die SQLite-Datenbank wird automatisch migriert.

## ⏰ Automatische Erinnerungen (Cronjob / Uptime Kuma)

Um automatische E-Mail-Erinnerungen für Events zu versenden, muss der folgende Endpoint regelmäßig (z.B. stündlich) über einen Dienst wie Uptime Kuma aufgerufen werden. Das System prüft dann selbstständig, ob für ein anstehendes Event Mails verschickt werden müssen:

`GET https://rsvp.deine-domain.de/api/cron/reminders?secret=DeinSehrGeheimesPasswort123`

## 🔒 Sicherheitshinweise

Die Datenbankdatei (`*.db`) und deine `.env`-Datei sind in der `.gitignore` vom Tracking ausgeschlossen. Stelle sicher, dass du niemals echte Passwörter oder Nutzerdaten in das Git-Repository hochlädst.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.