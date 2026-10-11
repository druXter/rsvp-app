# Wunschliste – Konzept

Idee N4 der Suite (`suite-kit/docs/IDEEN.md`), umgesetzt am 2026-10-11 als Teil von rsvp-app statt als eigenes Tool:
Die Gäste, ihre persönlichen Links und die Einladungen gibt es hier schon, ein eigenes Tool bräuchte Login,
Deployment und eine Kopplung nur für eine Liste.

## Was es gibt

* **Pro Termin** (Einzel-Event oder Reihen-Termin) ein Schalter „Wunschliste“ in den Einstellungen und der Reiter
  **„Wünsche“** zum Anlegen und Bearbeiten. Die Art „Hochzeit“ beim Anlegen schaltet sie gleich ein.
* **Geschenk:** Bezeichnung, Beschreibung, Link (nur http/https), ungefährer Preis, Anzahl (z. B. 6 Weingläser).
  Gäste reservieren Stück, höchstens so viele wie frei sind.
* **Geldwunsch:** Bezeichnung, Beschreibung, Link und ein **Zielbetrag** (z. B. Hochzeitsreise 2.000 €). Gäste tragen
  ihren Beitrag ein, die Seite zeigt den Fortschritt. Mehr als das Ziel ist erlaubt. Bezahlt wird außerhalb der App.

## Wer was sieht

* **Gäste** sehen die Liste auf der Termin-Seite, sobald sie die Seite sehen dürfen (PIN, Einladung). Reservieren
  geht nur über den **persönlichen Link** nach einer Antwort (auch einer Absage) bzw. mit einer Einladung zu diesem
  Termin. Sie sehen den Stand („vergeben“, „noch 2 von 6 frei“, „150 € von 2.000 €“) und ihre eigene Reservierung,
  nie, wer sonst was nimmt.
* **Verwaltung** (alle mit Zugriff auf die Gästeliste): Stand pro Wunsch und Summe der Geldwünsche. Mit
  **„Überraschung“** (Standard, `Event.wishesSecret`) keine Namen – die Seite lädt sie gar nicht. Ohne Überraschung
  (z. B. wenn Trauzeug\*innen die Liste führen) stehen die Namen mit Stück bzw. Betrag beim Wunsch.

## Regeln

* Eine Reservierung pro Gast und Wunsch (`WishReservation`, eindeutig), Ändern ersetzt sie, „Aufheben“ gibt frei.
* Stückzahl atomar begrenzt: Entfernen der alten und bedingtes Einfügen der neuen Reservierung in einer Transaktion,
  das Einfügen prüft die freie Menge in derselben SQL-Anweisung (wie die Mitbringliste). Gleichzeitige
  Reservierungen ergeben nie mehr als `Wish.quantity`; wer nicht mehr genug bekommt, behält seine bisherige.
* Die Verwaltung kann die Anzahl nicht unter das Reservierte senken und ein reserviertes Geschenk nicht in einen
  Geldwunsch umwandeln (oder umgekehrt). Löschen eines Wunschs löscht seine Reservierungen (mit Rückfrage).
* Reservierungen hängen am Participant: Löscht ein Gast seine Daten (oder fällt er als verwaister Participant weg),
  verschwinden sie mit. Eine Absage behält sie (schenken kann man auch ohne zu kommen).

## Technik

* `app/lib/wishlist.ts` (rein: Eingaben, Beträge, Stand), `app/lib/wishlist-store.ts` (Datenbank, Zugriff
  `guestOfEvent`, `reserveWish`), Gästeaktion `updateWishReservation` in `app/actions.ts`, Verwaltung in
  `app/admin/wish-actions.ts` und `app/admin/events/[id]/wuensche/`.
* Gästeansicht `app/ui/wish-list.tsx` auf `/[slug]` und `/reihe/[serie]/[termin]`.

## Später

* Eine Liste für eine ganze Reihe (heute pro Termin, bei einer Hochzeits-Reihe z. B. am Termin „Feier“).
* Kontoverbindung oder GiroCode für Geldwünsche, Mail an Schenkende.
