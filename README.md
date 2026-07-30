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
* **Personalisierte Links:** Gäste erhalten nach der Zusage einen einzigartigen, Token-basierten Link, über den sie ihre Antwort jederzeit nachträglich bearbeiten können.
* **iCal Integration:** Gäste können sich direkt eine `.ics`-Datei für Apple/Google/Outlook-Kalender herunterladen, in der ihr persönlicher Bearbeitungslink bereits hinterlegt ist.
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

1. **Repository klonen**
   \`\`\`bash
   git clone <deine-repo-url>
   cd rsvp-app
   \`\`\`

2. **Umgebungsvariablen setzen**
   Kopiere die Vorlage und öffne sie:
   \`\`\`bash
   cp .env.example .env
   \`\`\`
   Trage in der `.env` dein gewünschtes sicheres `ADMIN_PASSWORD` ein.

3. **Mit Docker starten (Empfohlen)**
   Baue und starte den Container:
   \`\`\`bash
   docker compose up -d --build
   \`\`\`
   Die App ist nun unter `http://localhost:3000` (bzw. auf deinem konfigurierten Port) erreichbar. Die SQLite-Datenbank wird automatisch migriert.

## 🔒 Sicherheitshinweise

Die Datenbankdatei (`*.db`) und deine `.env`-Datei sind in der `.gitignore` vom Tracking ausgeschlossen. Stelle sicher, dass du niemals echte Passwörter oder Nutzerdaten in das Git-Repository hochlädst.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.