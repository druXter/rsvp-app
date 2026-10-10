# Einladungen, Personen und Menü – Konzept

Umsetzung der Suite-Ideen **L2 (Einladungen pro Haushalt, mehrere Begleitungen)** und **L3 (Angaben pro Person,
Menüwahl)** aus `suite-kit/docs/IDEEN.md`, für die anstehende Hochzeit. Alles ist pro Termin optional: Ein Termin
ohne Begleitungen, Einladungen und Menü verhält sich genau wie bisher.

Leitlinie: **Eine Antwort, mehrere Personen.** Die Antwort (`Rsvp`) bleibt die Einheit für Platz, Warteliste,
Einlass, Seating und Zeitplan. Neu ist die Personenliste darin: Name, Altersgruppe, Zu-/Absage, Essen, Allergien und
Menü stehen pro Person.

---

## 1. Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Person** | Eine Person einer Antwort (`RsvpPerson`): die anmeldende Person selbst, ihre Begleitungen oder die Mitglieder eines eingeladenen Haushalts |
| **Begleitung** | Bei offener Anmeldung eine weitere Person der Antwort, höchstens `maxCompanions` pro Termin. Ersetzt das bisherige „+1“ |
| **Einladung** | Ein Haushalt („Familie Müller“) mit vorgegebenen Personen und persönlichem Link. Nur im Einladungsmodus |
| **Einladungsmodus** | Pro Termin: Nur eingeladene Haushalte können antworten (`inviteOnly`). Offene Anmeldung bleibt Standard |
| **Zusatzpersonen** | Wie viele weitere Personen ein Haushalt selbst eintragen darf (z. B. „+1“ für Single-Gäste), Standard 0 |
| **Altersgruppe** | Erwachsene · Kind · Kleinkind. Kleinkinder haben keinen eigenen Platz und kein Menü |
| **Gang** | Ein Teil des Menüs („Hauptgang“) mit Auswahlmöglichkeiten („Fisch“, „Fleisch“, „Vegetarisch“) |
| **Antwortfrist** | Optionales Datum pro Termin. Danach können Gäste nichts mehr ändern, nur noch die Verwaltung |

## 2. Personen und Begleitungen (L2)

* Einstellung pro Termin „bis zu N Begleitungen“ (`maxCompanions`, 0–20, bei Reihen pro Termin wie bisher „+1“).
  Das bisherige `formConfig.askPlusOne` wird beim Umstieg zu `maxCompanions = 1`, eine vorhandene Begleitung
  (`plusOne`/`plusOneName`) wird zur Person (Migrationsskript, in Prod gibt es keine).
* Eine Antwort hat eine Personenliste, sobald der Termin Begleitungen, Einladungen oder ein Menü hat. Bei offener
  Anmeldung ist Person 1 die anmeldende Person (Name, Essen und Allergien wie bisher aus dem Formular, auch fürs
  Profil einer Reihe), jede Begleitung hat eigene Felder: Name (Pflicht), Altersgruppe, Essen, Allergien, Menü.
* **Platzregel:** Plätze zählen Personen statt Antworten. Eine Antwort braucht so viele Plätze, wie sie zusagende
  Personen hat, Kleinkinder nicht mitgerechnet. Sie bekommt einen festen Platz nur als Ganzes, sonst kommt sie
  ganz auf die Warteliste. Nachrücken wie bisher: die am längsten wartende Antwort, für die gerade Platz ist.
  Fügt eine Antwort mit festem Platz Personen hinzu, für die kein Platz mehr ist, wird das abgelehnt (wie der
  Wechsel in eine volle Kategorie), weniger Personen geben Plätze frei.
* **Ticketkategorien** (Ball): Mit Kategorien gibt es weiterhin keine Begleitungen und keinen Einladungsmodus,
  weil Betrag und Einlass pro Person gelten. Ein Menü geht auch mit Kategorien (eine Person pro Antwort).
* **Seating:** Der Vertrag bleibt unverändert. `name` ist die erste zusagende Person, `companions` sind die weiteren
  zusagenden Personen ohne Kleinkinder (Seating erlaubt bis zu 50 Personen pro Antwort).
* **Zeitplan und Abstimmungstool:** unverändert, dort zählt nur die Antwort.

## 3. Einladungen pro Haushalt (L2)

### Einladungsmodus

* Schalter pro Einzel-Termin (`inviteOnly`). Nicht für Reihen, nicht zusammen mit „nur mit Konto“, PIN oder
  E-Mail-Verifizierung (der persönliche Link ersetzt diese Zugänge) und nicht mit Ticketkategorien.
* Ohne persönlichen Link zeigt die Event-Seite nur den Titel und „Nur mit persönlicher Einladung“ – keine
  Beschreibung, kein Ort, keine Gästeliste. Eine Antwort ohne Einladungslink lehnt der Server ab.

### Einladung anlegen

* Unter „💌 Einladungen“ (`/admin/einladungen/[eventId]`) mit Bezeichnung, E-Mail (optional), Personen mit
  Altersgruppe, Zusatzpersonen und interner Notiz.
* Viele auf einmal per Textfeld, eine Zeile pro Haushalt:
  `Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind), Dora (Kleinkind); +1`. E-Mail und Zusatzpersonen
  sind optional. Das Textfeld legt nur neue Einladungen an, ändern geht pro Einladung (der Link bleibt gleich).
* Eine Einladung legt sofort einen Participant mit `editToken` an: Der persönliche Link ist der bekannte
  `/{slug}?token=…`, damit funktionieren Bearbeiten, Bestätigungsmail und Erfolgsseite ohne Sonderweg.
* Löschen einer Einladung löscht auch die Antwort (mit Hinweis), Plätze werden frei, Seating wird informiert.

### Verteilen

* **Mail:** Knopf „Einladungen per Mail senden“ an alle Haushalte mit E-Mail, die noch keine bekommen haben, und
  „erneut senden“ pro Einladung. Die Mail nennt Termin, Ort, eingeladene Personen, Antwortfrist und den Link.
  Nur Owner und Admins (wie Erinnerungen).
* **Druckliste:** Seite mit Bezeichnung, Personen, Link und QR-Code je Haushalt, zum Ausdrucken oder für gedruckte
  Einladungskarten (`/admin/einladungen/[eventId]/druck`).
* Dazu kopierbarer Link und QR-Code pro Einladung.

### Antworten

* Über den Link sieht der Haushalt alle eingeladenen Personen und sagt **pro Person** zu oder ab. Namen dürfen
  korrigiert, aber nicht gelöscht werden. Bis zur Zahl der Zusatzpersonen können weitere Personen eingetragen
  werden.
* Die Antwort sagt zu, wenn mindestens eine Person zusagt. Haushaltsweite Angaben bleiben pro Antwort: Kontakt-
  E-Mail, Anmerkung, Zusatzfragen, Mitbringliste, Alkohol.
* Ändert die Verwaltung später die Personen der Einladung, sieht der Haushalt die neue Person als „noch offen“.

### Übersicht

Status pro Einladung: *offen* · *zugesagt (3 von 4)* · *abgesagt*, dazu Summen (Haushalte, Personen zugesagt,
abgesagt, offen; Erwachsene, Kinder, Kleinkinder) und „Mail gesendet am …“.

## 4. Angaben pro Person und Menü (L3)

* Essenswunsch und Allergien pro Person, wenn der Termin sie abfragt (bisherige Schalter).
* **Menü** pro Termin als Textfeld, eine Zeile pro Gang: `Hauptgang: Fisch; Fleisch; Vegetarisch`. Gespeichert wird
  per Abgleich nach Bezeichnung wie bei Kategorien. Ein Gang oder eine Option, die schon gewählt wurde, lässt
  sich nicht entfernen oder umbenennen (Fehlermeldung).
* Jede zusagende Person außer Kleinkindern wählt pro Gang eine Option (Pflicht). Ein Kindermenü ist einfach eine
  weitere Option.
* **Küchenübersicht** (`/admin/kueche/[eventId]`, alle mit Zugriff auf die Gästeliste): Anzahl je Option pro Gang,
  getrennt nach Erwachsenen und Kindern, Liste aller Personen mit Essen, Allergien, Menü und Sitzplatz (sortiert
  nach `seatingLabel`), Druckansicht und CSV mit einer Zeile pro Person.

## 5. Antwortfrist

* Optionales Datum pro Termin (`rsvpDeadline`, gilt bis 23:59 Uhr Ortszeit). Gäste sehen „Bitte antwortet bis …“.
* Danach sind Antworten, Personen, Menü und Mitbringliste für Gäste gesperrt (Formular nur lesend, Server lehnt ab,
  Client-API 400). Die Verwaltung kann weiter ändern. Nachrücken von der Warteliste läuft weiter.
* **Erinnerung:** Optional `rsvpReminderDays` Tage vor der Frist schickt der Cron `/api/cron/reminders` jeder
  Einladung mit E-Mail und ohne Antwort einmal eine Erinnerung mit dem Link (nur Einladungsmodus, bei offener
  Anmeldung gibt es niemanden, der noch nicht geantwortet hat). Dazu ein Knopf in der Einladungsübersicht.

## 6. Datenmodell

```prisma
// Event
maxCompanions    Int        @default(0)   // ersetzt formConfig.askPlusOne
inviteOnly       Boolean    @default(false)
rsvpDeadline     DateTime?
rsvpReminderDays Int?
invitations      Invitation[]
menuCourses      MenuCourse[]

model Invitation {
  id               String   @id @default(cuid())
  eventId          String   // Cascade
  participantId    String   @unique // vorab angelegt, editToken = persönlicher Link
  label            String
  email            String?
  extraPersons     Int      @default(0)
  note             String?  // nur Verwaltung
  sentAt           DateTime?
  reminderSentAt   DateTime?
  persons          InvitationPerson[]
  createdAt        DateTime @default(now())
}

model InvitationPerson {   // wer eingeladen ist (Verwaltung)
  id           String  @id @default(cuid())
  invitationId String  // Cascade
  name         String
  ageGroup     String  @default("ADULT") // ADULT | CHILD | INFANT
  position     Int
}

model RsvpPerson {         // wer antwortet (Gast)
  id                 String  @id @default(cuid())
  rsvpId             String  // Cascade
  invitationPersonId String? // SetNull
  position           Int
  name               String?
  ageGroup           String  @default("ADULT")
  isAttending        Boolean
  dietaryOption      String?
  allergies          String?
  menuChoices        MenuChoice[]
}

model MenuCourse {
  id       String @id @default(cuid())
  eventId  String // Cascade
  label    String
  options  String // JSON-Array der Optionen
  position Int
}

model MenuChoice {
  personId String // RsvpPerson, Cascade
  courseId String // MenuCourse, Cascade
  option   String
  @@id([personId, courseId])
}
```

`plusOne`/`plusOneName` an `Rsvp` entfallen nach der Migration. Alles andere ist neu und optional.

## 7. Weitere Stellen

* **Verwaltung:** Spalte „Personen“ statt „Begleitung“ (Anzahl und Namen, ausklappbar mit Angaben pro Person),
  Bearbeiten der Personen in `edit-rsvp`, Summen in der Kopfzeile zählen Personen.
* **Einlass:** zeigt alle zusagenden Personen der Antwort, eingecheckt wird die Antwort als Ganzes.
* **Gästeliste für Gäste** (`isGuestListVisible`): Namen der zusagenden Personen, im Einladungsmodus pro Haushalt.
* **Mails:** Bestätigung mit Personenliste und Menü. Push an die Verwaltung „Familie Müller: 3 Zusagen, 1 Absage“.
* **CSV:** Spalte „Personen“ in der bisherigen Liste, dazu die Personen-CSV der Küchenübersicht.
* **Client-API** (nur Reihen): GET liefert `persons`, POST nimmt optional `companions`
  (`[{name, ageGroup, dietaryOption, allergies, menu}]`). `plusOne`/`plusOneName` bleiben als Kurzform lesbar und
  schreibbar.
* **Datenschutzerklärung:** Namen, Altersgruppe, Essen, Allergien und Menü weiterer Personen (auch Kinder), die die
  anmeldende Person für sie angibt. Einladungsdaten (Bezeichnung, Namen, E-Mail), die die Veranstaltung einträgt,
  Einladungs- und Erinnerungsmails, Löschung mit dem Termin.

## 8. Schritte

Stand 2026-10-10: alle vier Schritte umgesetzt und deployed.

1. Personenliste mit Begleitungen und Angaben pro Person, Migration von „+1“, Platzregel nach Personen, Seating,
   Verwaltung, Einlass, CSV, API, Mails.
2. Menü mit Gängen, Wahl pro Person, Küchenübersicht.
3. Einladungen: Modus, Verwaltung, Textfeld-Import, Link, QR-Druckliste, Mail.
4. Antwortfrist mit Sperre und Erinnerung.
5. Doku (README, CLAUDE.md, Datenschutz, IDEEN.md), Deployment nach jedem Schritt.

Jeder Schritt mit Unit-Tests (reine Funktionen: Parser für Menü und Einladungen, Platzregel nach Personen,
Seating-Gast) und E2E-Tests (Angriffsfälle mit Positivkontrolle: mehr Begleitungen als erlaubt, fremde
Einladung, Antwort ohne Link im Einladungsmodus, Zusatzpersonen über dem Limit, Menüoption eines anderen Termins,
Antwort nach Fristende).

## 9. Später

* Einlass pro Person, Alkohol pro Person.
* Küchenliste pro Tisch: braucht vom Seating-Vertrag den Tisch pro Person statt nur des Platztexts pro Antwort.
* Einladungsmodus für Reihen.

## Abweichungen bei der Umsetzung

* Begleitungen brauchen einen Namen (wie früher das „+1“).
* Personen einer Haushalts-Antwort ändert die Verwaltung über den Einladungslink („Antwort ansehen“), nicht über
  „Antwort bearbeiten“ - dort bleiben Personen und Zu-/Absage unangetastet.
* Einladungen anlegen, ändern und löschen dürfen auch Moderator\*innen, Mails verschicken nur Owner und Admins.
* Farben: Einladungen indigo (wie die übrigen Zugangs-Einstellungen), Menü und Küche orange (neue Themenfarbe).
* Ohne Link zeigt die Seite nur den Titel; Kalenderdatei und Abstimmungs-Link gibt es nur mit Antwort.

## Entschieden (2026-10-10)

* Mehrere Begleitungen auch bei offener Anmeldung (bis zu N pro Termin), ersetzt „+1“.
* Einladungslinks per Mail (wenn E-Mail hinterlegt) und als Druckliste mit QR-Codes.
* Zusatzpersonen pro Einladung freigebbar, Standard 0. Vorgegebene Namen dürfen korrigiert, nicht gelöscht werden.
* Antwortfrist optional pro Termin, danach nur noch die Verwaltung. Erinnerung an Eingeladene ohne Antwort.
* Kleinkinder ohne eigenen Platz und ohne Menü (Annahme, leicht änderbar).
