# Antwort „Vielleicht“ – Konzept

Idee L26 der Suite (`suite-kit/docs/IDEEN.md`), Konzept und Umsetzung vom 2026-10-25. Gäste können pro Termin
statt Zu- oder Absage „Vielleicht“ antworten, wenn die Verwaltung es erlaubt. Sie legen dabei fest, wann sie erinnert
werden, und müssen sich bis zum Stichtag entscheiden, sonst gilt die Antwort als Absage.

## Grundsatz: „Vielleicht“ ist für alles außer der Gästeliste eine Absage

* Gespeichert als Absage (`Rsvp.isAttending = false`) mit eigenem Merker und Erinnerungszeitpunkt
  (`Rsvp.isMaybe`, `Rsvp.maybeRemindAt`, `Rsvp.maybeRemindedAt`, im Einladungsmodus `RsvpPerson.isMaybe`). Kein Status mit drei Werten: `isAttending` hat über
  200 Fundstellen, eine übersehene könnte Zugang gewähren.
* Damit gilt ohne Änderung an den Verträgen: kein Zugang zu Abstimmungstool, Sitzung, Seating, Zeitplan, Wichteln,
  Fotos, Feedback; kein Platz, keine Warteliste, keine Mitbringliste, kein Menü, kein Ticket, keine Erinnerung an
  Zusagen. Im Formular verhält sich „Vielleicht“ wie eine Absage (Felder ausgeblendet, Beanspruchungen frei).
* Gezielt angepasst wird, was eine Absage von „Vielleicht“ unterscheiden muss: Gästeliste der Verwaltung (eigener
  Filter und eigene Zahl), **öffentliche Gästeliste** (mit Namen, wie Zusagen), Summen der Client-API
  (`responses.maybe`), Verwaltungs-API, CSV-Export (Spalte „Antwort“: Vielleicht), Push an die Verwaltung („neues
  Vielleicht“), keine Absage-Mail und kein Absagegrund.
* Termin-Änderungen (Ort, Uhrzeit, Titel) gehen auch an „Vielleicht“.

## Einschalten

* Schalter „Vielleicht erlauben“ pro Einzel-Event oder für eine Reihe (an die Termine weitergegeben wie die anderen
  Reihen-Einstellungen).
* Nur aktivierbar, wenn die E-Mail-Adresse abgefragt wird. Das Formular sperrt den Schalter mit Hinweis, wenn etwas
  dagegen spricht. Antworten, die Schichten verwaltet (`shiftHelperId`), können nie „Vielleicht“ sein.
* Beim Bearbeiten einer Antwort kann die Verwaltung „Vielleicht“ nur behalten oder beenden. Neu setzen kann sie es nur
  beim Eintragen eines Gasts von Hand (Reiter „Gäste“, `app/admin/manual-rsvp-actions.ts`): Erinnerung zum spätesten
  erlaubten Zeitpunkt, nur an eine bestätigte Adresse (bestätigt nur mit Haken), am Stichtag Absage wie sonst.

## Stichtag und Erinnerung

* **Stichtag** = früherer Zeitpunkt aus Antwortfrist (`Event.rsvpDeadline`, Ende des Tages) und Beginn − 12 h. Ohne
  Antwortfrist also Beginn − 12 h.
* Der Gast wählt einen **Erinnerungszeitpunkt** (volle Stunde, der Cron `/api/cron/reminders` läuft stündlich): in der
  Zukunft und spätestens 24 h vor dem Stichtag.
* „Vielleicht“ wird nur angeboten, solange so ein Zeitpunkt noch möglich ist (die nächste volle Stunde liegt
  spätestens 24 h vor dem Stichtag). Ein bestehendes „Vielleicht“ danach zeigt das Formular ohne Auswahl mit der Bitte,
  zu- oder abzusagen.
* **Erinnerung:** Mail (und Push, falls der Gast Push eingerichtet hat) mit der Bitte, zu- oder abzusagen. Der Link
  führt auf die persönliche Seite mit Knöpfen bzw. dem Formular, nie eine Zusage per Klick im Link (Link-Scanner).
  Hinweis, dass bei vollem Termin eine Zusage auf die Warteliste führt.
* **Automatische Absage** am Stichtag: Wer noch auf „Vielleicht“ steht, wird auf Absage gesetzt und per Mail (und
  Push) informiert. Mit Antwortfrist ist das endgültig (das Formular ist dann zu), ohne Antwortfrist kann der Gast bis
  zum Beginn noch zusagen.

## Bestätigte Adresse

* „Vielleicht“ braucht eine bestätigte Adresse (Double-Opt-In), auch wenn der Termin sonst keine Bestätigung verlangt.
  Bestätigt wird wie bisher am Participant (`isVerified`), das gilt für alle Termine einer Reihe.
* Teilnehmendenkonten haben schon eine bestätigte Adresse und brauchen keine zweite Bestätigung.
* Ohne bestätigte Adresse geht keine Erinnerung raus. Die Gästeliste zeigt „Vielleicht – Mail nicht bestätigt“ bzw.
  „Vielleicht – keine Erinnerung aktiv“. Am Stichtag wird auch ein unbestätigtes „Vielleicht“ zur Absage.

## Änderungen durch die Verwaltung

* **Termin vorverlegt oder Antwortfrist früher:** Erinnerungen, die jetzt zu spät liegen, rücken auf den spätesten
  erlaubten Zeitpunkt; liegt der in der Vergangenheit, geht die Erinnerung sofort raus.
* **Terminabstimmung mit offenem Datum** (`datePending`): „Vielleicht“ ist möglich, der Erinnerungszeitpunkt nur durch
  die Antwortfrist begrenzt. Steht das Datum fest, gilt dieselbe Regel wie beim Vorverlegen.
* **Schalter ausgeschaltet** bei vorhandenen „Vielleicht“: Warnung mit Anzahl, dann werden alle auf Absage gesetzt und
  per Mail informiert, dass sie selbst zusagen können (sofern die Antwortfrist das noch erlaubt).

## Begleitungen und Einladungen

* **Offene Anmeldung mit Begleitungen:** „Vielleicht“ nur für die ganze Antwort. Begleitungen kommen dort heute nur
  zusammen mit der anmeldenden Person (`rsvp-submission.ts`), „Begleitung kommt ohne mich“ gibt es in diesem Modus
  nicht – die Begleitung meldet sich dann selbst an.
* **Einladungsmodus (Haushalte, z. B. Hochzeit):** „Vielleicht“ **pro Person**, weil dort ohnehin jede Person einzeln
  zu- oder absagt. Beispiel: Anna vielleicht, Ben und Clara kommen. Gespeichert am `RsvpPerson` (eigener Merker, die
  Person zählt als Absage); die Antwort des Haushalts ist „Vielleicht“, wenn niemand zusagt und mindestens eine Person
  vielleicht kommt. Ein Erinnerungszeitpunkt pro Haushalt. Verknüpfte Tools sehen wie bisher nur zusagende Personen.
* Im Einladungsmodus ist die Verifizierung heute ausgeschlossen, weil der persönliche Link den Zugang ersetzt. Das
  bleibt so; für „Vielleicht“ braucht der Haushalt trotzdem eine bestätigte Adresse: eine von der Verwaltung
  eingetragene Adresse gilt nicht als bestätigt, der Haushalt bestätigt sie einmal über einen Link.
* Sagt eine Person mit „Vielleicht“ später zu, gilt die bestehende Platzregel: Ist kein Platz mehr frei, lehnt das
  Formular die zusätzliche Person mit Meldung ab.

## Verwaltung

* Gästeliste: Filter „Vielleicht“, Abzeichen und Stand der Erinnerung („Mail nicht bestätigt“, „Erinnerung …“,
  „erinnert am …“), bei Haushalten die Personen. Kennzahlen zählen „vielleicht“ eigens, nicht als Absage. CSV mit
  Spalte „Vielleicht“, APIs mit `maybe`.
* „Antwort bearbeiten“: „Vielleicht“ lässt sich nur behalten oder durch Zu- bzw. Absage ersetzen, nie setzen.
* Termin-Änderungen gehen an Zusagen und an „vielleicht“ mit bestätigter Adresse.

## Technik

* Regeln rein in `app/lib/maybe.ts` (Stichtag, Erinnerungszeitpunkt, Formular, Anzeige), Datenbank und Versand in
  `app/lib/maybe-store.ts` (Cron, Abschalten, Vorverlegen). Die Antwort selbst nur in `performRsvpSubmission`.
* Invariante: `Rsvp.maybeRemindAt` ist genau dann gesetzt, wenn etwas auf „vielleicht“ steht.
* Tests: `tests/unit/maybe.test.ts`, `tests/e2e/maybe.spec.ts` (Formular, Seating bleibt zu, API mit Grenzfällen, Cron,
  Einstellungen mit umgangenem Formular, Verwaltung, Einladungsmodus).

## Datenschutz

`/datenschutz` Punkte 5, 6, 7 und 17: Erinnerungszeitpunkt, Pflicht zur bestätigten Adresse bei „Vielleicht“,
Erinnerungs- und Absage-Mail bzw. Push, Anzeige in der öffentlichen Gästeliste, Löschung des Zeitpunkts mit der
Entscheidung.
