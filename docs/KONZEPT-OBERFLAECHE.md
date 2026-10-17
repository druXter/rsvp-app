# Oberfläche der Verwaltung – Konzept

Neugestaltung vom 2026-10-10. Ziel: Die Verwaltung soll auch mit vielen Events, großen Gästelisten und den neuen
Funktionen (Tickets, Einladungen, Menü) überschaubar bleiben – am Rechner und auf dem Handy.

## Ausgangslage

* Die Startseite zeigte alles auf einmal: jedes Event (auch vergangene) und jeden Reihen-Termin mit seiner kompletten
  Gästetabelle. Schon wenige Events ergaben eine sehr lange Seite ohne Kennzahlen auf einen Blick.
* Die Gästetabelle hatte bis zu 15 Spalten, die meisten leer, mit seitlichem Scrollen; auf dem Handy kaum benutzbar.
* Das Termin-Formular war eine lange Seite mit vierzehn farbigen Kästen und existierte dreimal (Anlegen, Bearbeiten,
  Reihen-Termin).
* Einladungen, Küche und Zahlungen hingen als kleine Links in der Tabelle, jede Seite mit eigenem Zurück-Link.
* Die Gästeseite zeigte weder Titel noch Datum, Ort oder Beschreibung.

## Aufbau

| Seite | Inhalt |
| --- | --- |
| `/admin` | Übersicht: *Anstehend*, *Reihen* (mit den nächsten zwei Terminen), eingeklappt *Vergangen*. Pro Event Datum, Merkmale (Einladungen, Tickets, Menü, freigegeben) und Kennzahlen (Zusagen, Personen, Absagen, Warteliste, offene Einladungen, offene Zahlungen, Kapazität). |
| `/admin/events/[id]` | Event-Seite mit Kopf (Titel, Datum, Ort, Merkmale, „Gästeseite ↗“) und Reitern: **Übersicht** (Kennzahlen, Hinweise, Link für Gäste, CSV, Erinnerung, Tickets, Mitbringliste), **Gäste**, je nach Event **Einladungen**, **Küche**, **Zahlungen**, für Owner/Admins **Einstellungen**. |
| `/admin/series/[id]` | Reihe mit Reitern **Termine** (Liste, „+ Termin hinzufügen“, Löschen) und **Einstellungen und Mitglieder**. Jeder Termin hat seine eigene Event-Seite. |
| `/admin/create` | Neues Event: Grunddaten und die Art (offene Anmeldung, Feier, Hochzeit mit Einladungen, Ball mit Tickets, `app/lib/event-presets.ts`). Danach geht es direkt in den passenden Bereich der Event-Seite. |

Frühere Adressen (`/admin/edit/[id]`, `/admin/edit-termin/[id]`, `/admin/einladungen/[id]`, `/admin/kueche/[id]`,
`/admin/zahlungen/[id]`) leiten auf den passenden Reiter weiter, mit Query. Die Druckliste der Einladungen bleibt eine
eigene Seite ohne Rahmen.

## Gästeliste

Filter (Alle, Zusagen, Warteliste, Absagen, Zahlung offen) mit Anzahl, Suche nach Name/E-Mail, CSV. Pro Antwort:
Name mit Begleitungen bzw. Personen des Haushalts, Status mit „Zulassen“, je nach Event Ticket/Zahlung, Menü, Einlass,
dazu Bearbeiten und Löschen. Alles Übrige (Kontakt, Bestätigung, Essen pro Person, Alkohol, Mitbringsel, Anmerkungen,
Zusatzfragen, Platz, Datum) steht aufklappbar unter „Details“. Auf dem Handy wird jede Zeile zur Karte (eine Tabelle,
per CSS umgebrochen).

## Einstellungen

Ein Formular (`app/admin/event-settings-form.tsx`) für Einzel-Events und Reihen-Termine, in einklappbaren Abschnitten
mit Kurzstand: Grunddaten · Anmeldeformular · Zugang und Gästeliste (nur Einzel-Events) · Erinnerung und Einlass ·
Menü · Mitbringliste · Tickets und Bezahlung · Verknüpfungen (Seating, Zeitplan, Abstimmung, Fotos). Die
Speichern-Leiste bleibt unten sichtbar. Feldnamen sind unverändert, die Server Actions lesen wie bisher; zugeklappte
Abschnitte werden mitgeschickt. Darunter Freigaben und Löschen.

## Gestaltung

* Ruhig: weiß/grau, Blau nur für Hauptaktionen und den aktiven Reiter. Bausteine aus `suite-kit/ui` (seit suite-kit
  v0.3.0 gemeinsam für alle Tools, Regeln in `docs/DESIGN.md` dort), re-exportiert in `app/ui/kit.tsx` mit dem eigenen
  `formatShortDate`; Grundregeln (Darkmode, Ränder, Hintergrund) aus `suite-kit/theme.css`.
* Farbe trägt Bedeutung: Status-Badges (grün dabei, orange Warteliste, rot Absage/überfällig) und eine kleine
  farbige Marke je Thema (die bisherigen Themenfarben aus `app/ui/theme-section.tsx`).
* Rahmen aller Verwaltungsseiten: `AdminShell` mit Kopfzeile (`AppHeader` aus suite-kit/ui) (Events, bei Admins Konten) und Konto-Menü
  (Einstellungen, Konto anlegen, „Mein Konto“, Push, Abmelden). Beim Drucken ausgeblendet.

## Gästeseite

Kopf mit Titel, Datum, Dauer, Ort und Beschreibung über dem Formular (`app/ui/event-header.tsx`), bei Reihen mit dem
Namen der Reihe. Im Einladungsmodus erst mit gültigem Link. Das Formular selbst ist unverändert.
