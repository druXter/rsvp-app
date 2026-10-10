# Tickets und Bezahlung – Konzept

Umsetzung der Suite-Ideen **L4 (Ticketkategorien und Kontingente)** und **L1 (Preise, Bezahlstatus, GiroCode,
Abendkasse)** aus `suite-kit/docs/IDEEN.md`, für den anstehenden Ball. Alles ist pro Termin optional: Ein Termin ohne
Kategorien verhält sich genau wie bisher.

Leitlinie: **kein Zahlungsanbieter.** Gäste überweisen selbst (GiroCode, eindeutiger Verwendungszweck), die Verwaltung
gleicht ab und markiert. An der Abendkasse wird bar kassiert und markiert.

---

## 1. Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Kategorie** | Ticketart eines Termins („Studierende“, „Gäste“, „Ball mit Dinner“) mit Preis und optionalem Kontingent |
| **Kontingent** | Höchstzahl fester Plätze einer Kategorie. Die Gesamtkapazität des Termins (`maxCapacity`) bleibt Obergrenze |
| **Betrag** | Was eine Zusage zahlen muss. Wird beim Wählen der Kategorie aus deren Preis übernommen und danach festgeschrieben |
| **Verwendungszweck** | Eindeutiger Code pro Zusage (`BALL-7KQ3M2`), über den eine Überweisung zugeordnet wird |
| **Zahlfrist** | Optional, Tage ab festem Platz. Nur Anzeige: Überfällige Zusagen werden markiert und können per Klick storniert werden |

## 2. Kategorien und Kontingente (L4)

* Die Verwaltung pflegt Kategorien als Textfeld, eine Zeile pro Kategorie: `Bezeichnung; Preis; Kontingent`.
  Preis und Kontingent sind optional (`Studierende; 25; 120`, `Gäste; 35,50`, `Helfer*innen; 0; 20`). Gespeichert
  wird per Abgleich nach Bezeichnung wie bei der Mitbringliste. Eine Kategorie, die noch Antworten hat, lässt sich
  nicht entfernen (Fehlermeldung), umbenennen geht nur, solange sie leer ist.
* Gäste mit Zusage **müssen** eine Kategorie wählen. Das Formular zeigt Preis und freie Plätze, volle Kategorien
  sind als „ausgebucht – Warteliste“ gekennzeichnet und bleiben wählbar.
* **Platzregel:** Eine Zusage bekommt einen festen Platz, wenn ihre Kategorie *und* der Termin insgesamt noch Platz
  haben, sonst kommt sie auf die Warteliste dieser Kategorie. Einen bestehenden festen Platz behält sie, solange die
  Kategorie gleich bleibt. Ein Wechsel in eine volle Kategorie wird abgelehnt (nicht stillschweigend Warteliste).
* **Nachrücken:** Wird ein Platz frei, rückt die am längsten wartende Zusage nach, *für die* gerade Platz ist
  (Kategorie und gesamt). Eine Regel für alle Wege: Absage, Löschen, Kapazität erhöht, Verifizierung, Stornieren.
  Dafür wandert die bisher doppelte Nachrück-Logik (`performRsvpSubmission` und `triggerWaitlistPromotion`) in
  `app/lib/waitlist.ts`.
* **Begleitung:** Bei Terminen mit Kategorien gibt es keine Begleitung (Formularfeld ausgeblendet, serverseitig
  ignoriert). Jede Person meldet sich selbst an, damit Kategorie, Betrag und Einlass pro Person stimmen. Mehrere
  Personen pro Anmeldung kommen mit L2.
* Kategorie sichtbar in Verwaltung (Spalte und Übersicht „Studierende 87/120“), CSV und beim Einlass.

## 3. Geld (L1)

### Einstellungen pro Termin

Empfänger\*in (Kontoinhaber), IBAN (Prüfsumme wird geprüft), BIC optional, Zahlfrist in Tagen optional. Pflicht,
sobald eine Kategorie einen Preis über 0 hat.

### Pro Zusage

* `amountCents` und `paymentReference` werden gesetzt, wenn eine Kategorie mit Preis gewählt wird. Eine spätere
  Preisänderung trifft nur neue Zusagen. Wechselt ein Gast vor der Zahlung die Kategorie, ändert sich der Betrag.
  Nach der Zahlung kann nur noch die Verwaltung die Kategorie ändern.
* **Zahlung fällig** ist nur ein fester Platz. Wer auf der Warteliste steht, bekommt die Zahlungsdaten erst beim
  Nachrücken (mit der Bestätigungsmail).
* Status (eine reine Funktion, `paymentState`): `keiner` (kostenlos) · `offen` · `überfällig` · `bezahlt`
  (Überweisung oder bar) · `Erstattung offen` (bezahlt, dann abgesagt) · `erstattet`.

### Gäste sehen

* Auf der Erfolgsseite, auf der Event-Seite über den persönlichen Link und in der Bestätigungsmail: Betrag,
  Empfänger\*in, IBAN, Verwendungszweck, ggf. Frist und einen **GiroCode** (EPC-QR, Version 002), den
  Banking-Apps einlesen.
* Nach Zahlungseingang: „✓ Bezahlt am …“ statt der Zahlungsdaten, dazu eine Mail „Zahlung eingegangen“ (nur bei
  Überweisung, nicht bei Barzahlung am Einlass).
* Wer bezahlt hat und absagt, sieht vorher einen Hinweis, dass die Erstattung die Veranstaltung klärt.

### Verwaltung (Owner, Admin und Moderator\*innen)

* Spalte „Zahlung“ mit Kategorie, Betrag, Verwendungszweck, Status und Knöpfen: *bezahlt (Überweisung)*, *bar
  bezahlt*, *zurücksetzen*, bei Absage nach Zahlung *erstattet*.
* Kopfzeile: Summe bezahlt / offen, Anzahl überfällig.
* Überfällige Zusagen tragen den Knopf **Stornieren**: Die Zusage wird zur Absage („Zahlungsfrist abgelaufen“),
  der Gast bekommt eine Mail, die Warteliste rückt nach. Nichts verfällt automatisch.
* Moderator\*innen dürfen kassieren, damit Helfer\*innen an der Abendkasse stehen können.

### Einlass und Abendkasse

* Der Einlass-Scan zeigt Kategorie und Zahlstatus groß an.
* Ist eine Zahlung offen, checkt der Scan **nicht** automatisch ein, sondern zeigt „Offen: 25,00 €“ mit
  *Bar kassiert – einlassen* und *Ohne Zahlung einlassen*. Bezahlte und kostenlose Zusagen checken wie bisher beim
  Aufruf ein.

### Rückerstattung

Nur Statusverwaltung: Eine bezahlte Absage erscheint als „Erstattung offen“, die Verwaltung überweist selbst und
markiert *erstattet*.

## 4. Sitzplatzwahl erst nach Zahlung

Schalter pro Termin (`seatingRequiresPayment`, nur sichtbar mit Seating-Link). Ist er an, zählt eine Zusage mit
offenem Betrag bei Seating **nicht** als bestätigt: kein „Sitzplatz wählen“, Webhook `attending: false`, nicht in der
Gästeliste für Seating. Mit dem Markieren als bezahlt geht `attending: true` an Seating, die Mail „Zahlung
eingegangen“ enthält dann den Link zur Sitzplatzwahl. Gäste sehen statt des Knopfs „Sitzplatzwahl nach
Zahlungseingang“.

Der Vertrag mit Seating bleibt unverändert, nur die Regel „zählt bei Seating“ (`isSeatingConfirmed`) bekommt die
Zahlung als zusätzliche Bedingung. Der Zeitplan ist nicht betroffen. Wird der Schalter bei einem Termin mit schon
gewählten Plätzen eingeschaltet, verlieren unbezahlte Zusagen ihren Platz bei Seating – darauf weist die Verwaltung
beim Einschalten hin, und rsvp-app sendet für alle Zusagen des Termins den neuen Stand.

## 5. Datenmodell

```prisma
model TicketCategory {
  id         String  @id @default(cuid())
  eventId    String  // Cascade
  label      String
  priceCents Int     @default(0)
  capacity   Int?
  position   Int
  rsvps      Rsvp[]
}

// Event
paymentRecipient       String?
paymentIban            String?
paymentBic             String?
paymentDueDays         Int?
seatingRequiresPayment Boolean @default(false)

// Rsvp
ticketCategoryId String?   // SetNull (Löschen eines Events darf nie an einer Kategorie scheitern)
amountCents      Int?
paymentReference String?   @unique
paymentDueAt     DateTime? // gesetzt, sobald der Platz fest und eine Zahlung fällig ist
paidAt           DateTime?
paymentMethod    String?   // TRANSFER | CASH
refundedAt       DateTime?
```

Alle Spalten sind neu und optional, `prisma db push` reicht (keine Datenmigration).

## 6. Weitere Stellen

* **Client-API** (`POST /api/v1/termine/[eventId]/antwort`): optionales Feld `ticketCategoryId`. Ohne Kategorie bei
  einem Termin mit Kategorien → 400, außer die Antwort hat schon eine.
* **CSV:** Kategorie, Betrag, Verwendungszweck, Zahlstatus, bezahlt am, Zahlart, erstattet am.
* **Datenschutzerklärung:** neue Daten (Kategorie, Betrag, Verwendungszweck, Zahlstatus und -zeitpunkte, Zahlart).
  Kontodaten von Gästen speichert rsvp-app nicht.
* **Reihen:** Kategorien und Zahlung sind pro Termin, auch auf der Termin-Bearbeiten-Seite einer Reihe (nicht im
  Schnell-Anlegen).

## 7. Schritte

1. Kategorien und Kontingente, gemeinsame Nachrück-Logik (L4).
2. Betrag, Verwendungszweck, GiroCode, Zahlungsdaten für Gäste und in Mails.
3. Bezahlstatus in der Verwaltung, Frist und Stornieren, Erstattung, Einlass und Abendkasse, CSV.
4. Sitzplatzwahl erst nach Zahlung.
5. Doku (README, CLAUDE.md, Datenschutz, IDEEN.md), Deployment.

Jeder Schritt mit Unit-Tests (reine Funktionen: Parser, IBAN, GiroCode, Platzregel, Zahlstatus) und E2E-Tests
(Angriffsfälle mit Positivkontrolle: fremde Kategorie-ID, Zahlstatus ohne Rechte, Kategorie nach Zahlung ändern).

## 8. Später

* **Kontoauszug-Import** (CSV der Bank, Verwendungszweck → Zusage, Vorschau vor dem Markieren).
* Zahlungserinnerung per Mail vor Ablauf der Frist.
* Begleitungen und Angaben pro Person (L2/L3).

## Entschieden (2026-10-10)

* Umfang L4 + L1, Menüwahl (L3) erst mit der Hochzeit.
* Zahlfrist nur zur Anzeige, Stornieren per Klick, kein automatischer Verfall.
* Moderator\*innen dürfen den Bezahlstatus setzen (Abendkasse).
* Sitzplatzwahl erst nach Zahlung, schaltbar pro Termin.
* Keine Begleitung bei Terminen mit Kategorien (bis L2).
* Rückerstattung nur als Status.
