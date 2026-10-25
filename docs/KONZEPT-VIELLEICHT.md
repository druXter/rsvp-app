# Antwort „Vielleicht“ – Konzept

Idee L26 der Suite (`suite-kit/docs/IDEEN.md`), Konzept vom 2026-10-25, noch nicht umgesetzt. Gäste können pro Termin
statt Zu- oder Absage „Vielleicht“ antworten, wenn die Verwaltung es erlaubt. Sie legen dabei fest, wann sie erinnert
werden, und müssen sich bis zum Stichtag entscheiden, sonst gilt die Antwort als Absage.

## Grundsatz: „Vielleicht“ ist für alles außer der Gästeliste eine Absage

* Gespeichert als Absage (`Rsvp.isAttending = false`) mit eigenem Merker und Erinnerungszeitpunkt (z. B.
  `Rsvp.maybeAt`, `Rsvp.maybeRemindAt`, `Rsvp.maybeRemindedAt`). Kein Status mit drei Werten: `isAttending` hat über
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
* Die Verwaltung kann „Vielleicht“ nicht selbst eintragen (keine bestätigte Adresse, keine Entscheidung des Gasts).

## Stichtag und Erinnerung

* **Stichtag** = früherer Zeitpunkt aus Antwortfrist (`Event.rsvpDeadline`, Ende des Tages) und Beginn − 12 h. Ohne
  Antwortfrist also Beginn − 12 h.
* Der Gast wählt einen **Erinnerungszeitpunkt** (volle Stunde, der Cron `/api/cron/reminders` läuft stündlich): in der
  Zukunft und spätestens 24 h vor dem Stichtag.
* „Vielleicht“ wird nur angeboten, solange so ein Zeitpunkt noch möglich ist (jetzt + 1 h ≤ Stichtag − 24 h).
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

## Begleitungen und Einladungen (Vorschlag, noch zu bestätigen)

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

## Datenschutz

`/datenschutz` ergänzen: Erinnerungszeitpunkt, Pflicht zur bestätigten Adresse bei „Vielleicht“, Erinnerungs- und
Absage-Mail bzw. Push, Löschung mit der Antwort.
