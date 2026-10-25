# 🎉 RSVP Event Management System

Ein schlankes, anpassbares und leistungsstarkes Event-Management-System, gebaut mit Next.js, TypeScript und Prisma. Perfekt für alles – von der privaten Geburtstagsfeier bis hin zu großen Uni-Events.

## ✨ Features

* **Mehrere Verwaltungskonten mit Rollen & geteiltem Zugriff:** Verschiedene Referate, Vereine oder Freunde können dasselbe Tool getrennt voneinander nutzen - jedes Creator-Konto sieht und verwaltet ausschließlich seine eigenen Events und Reihen. Es gibt keine offene Registrierung; neue Konten werden von bereits eingeloggten Verwaltungskonten über "+ Konto anlegen" erstellt. Drei Rollen: **Admin** (voller Zugriff auf alle Konten, einzige Rolle, die neue Creator- oder Admin-Konten anlegen darf, verwaltet alle Konten über "👥 Nutzerverwaltung" inkl. Rollenwechsel & Löschen - ausgenommen andere Admin-Konten), **Creator** (eigenständiges Konto mit eigenen Events/Reihen, kann Moderator-Konten anlegen), **Moderator** (kein eigenes Event, nur mit ihm/ihr geteilter Zugriff). Ein Creator kann einzelne Events oder ganze Reihen gezielt mit einem Moderator-Konto teilen (Check-in durchführen, Gäste-/Wartelisten einsehen & bearbeiten), ohne diesem vollen Zugriff auf das eigene Konto zu geben. Passwort vergessen? Creator- und Moderator-Konten können es sich selbst per E-Mail-Link zurücksetzen (`/admin/forgot-password`) - für Admin-Konten ist das bewusst nicht möglich, dort bleibt ein Reset nur über direkten Server-Zugriff (`set-role.js`/`create-user.js`) möglich. Jedes eingeloggte Konto (ausdrücklich auch Admins) kann sein Passwort und seine E-Mail-Adresse aber unter "⚙️ Konto-Einstellungen" selbst ändern, sofern es das aktuelle Passwort kennt - eine E-Mail-Änderung wird erst nach Bestätigung über einen an die neue Adresse geschickten Link wirksam.
* **Multi-Event-Support:** Verwalte beliebig viele Events gleichzeitig über dynamische URLs (z.B. `/sommerfest`).
* **Veranstaltungsreihen:** Optional mehrere Termine zu einer Reihe bündeln (z.B. ein wöchentlicher Stammtisch). Kontaktdaten, Essenswunsch und Allergien werden dabei nur einmal pro Person abgefragt und automatisch für jeden weiteren Termin der Reihe übernommen; Zusage, Warteliste und der Rest der Antwort bleiben pro Termin individuell. Eigene Übersichtsseite je Reihe (`/reihe/[slug]`), reihenweite PIN und Gästeliste. Vergangene Termine verschwinden 48 Stunden nach Beginn aus den Listen: In der Verwaltung landen sie im eingeklappten "🗄️ Archiv" der Reihe (Gästeliste und Export bleiben dort vollständig erreichbar), Teilnehmende sehen sie in der Reihen-Übersicht und unter `/mein-konto` nicht mehr - der persönliche Link aus der Mail funktioniert weiterhin. Termine mit noch offenem Datum (Terminabstimmung) werden nie archiviert. Einzel-Events bleiben davon komplett unberührt und sind weiterhin der Standardfall.
* **Teilnehmendenkonten für Stammgäste (optional, PWA-fähig):** Gäste einer Reihe können sich unter `/reihe/[slug]/registrieren` selbst ein Login-Konto anlegen (E-Mail-Bestätigung erforderlich) und sich danach unter `/mein-konto` einloggen - dort sehen sie automatisch alle Termine jeder ihnen zugeordneten Reihe samt Antwortstatus, ganz ohne sich Links merken zu müssen. Kontaktdaten, Essenswunsch und Allergien werden zentral am Konto gepflegt und gelten sofort für alle Reihen. Ein solches Konto kann mehreren Reihen zugeordnet sein (z.B. Stammtisch UND Kino-Abend) - ein Creator/Moderator kann ein bestehendes Konto jederzeit einer weiteren Reihe hinzufügen, ohne dass sich der Gast neu registrieren müsste. Passwort vergessen? Geht auch hier selbst per E-Mail-Link (`/mein-konto/forgot-password`), unabhängig vom Passwort-Reset der Verwaltungskonten. Direkt im Konto (mit aktuellem Passwort) lassen sich Passwort und E-Mail-Adresse ebenfalls jederzeit selbst ändern. Wer beide Konten hat (z.B. ein Moderator, der bei einer fremden Reihe auch ganz normal als Gast teilnimmt), kann sie verknüpfen, dann meldet der Verwaltungs-Login unter "Mein Konto" mit an (siehe "Konto-Sicherheit"), und bekommt nach dem Login in beiden Bereichen einen direkten Wechsel-Link zum jeweils anderen - praktisch v.a. in der installierten PWA, die als App-Verknüpfung zusätzlich direkte Shortcuts zu "Verwaltung" und "Mein Konto" anbietet. Mit dem Teilnehmendenkonto kann man sich - nach Zustimmung - auch in verbundenen Tools anmelden, z.B. zum Abstimmen (siehe "Teilnehmendenkonten im Verbund").
* **Verwaltungs-API (nur lesen, optional):** Verwaltungskonten erzeugen unter „Konto-Einstellungen“ API-Tokens (`rsvpv_…`, nur der SHA-256-Hash wird gespeichert, einmal angezeigt, widerrufbar) für eigene Programme, z.B. einen Bot. `GET /api/v1/verwaltung/me`, `GET /api/v1/verwaltung/termine` (ab vorgestern, `?alle=1` alle; Summen der Antworten und Menü-Gänge) und `GET /api/v1/verwaltung/termine/[id]/kueche` (Küchenübersicht: Wahl pro Gang gezählt, Personen mit Name, Menüwahl und Tisch). Der Token hat genau die Rechte, die das Konto in der Oberfläche hat (Admin-Rolle alles, sonst eigene und freigegebene Events/Reihen, bei jeder Anfrage neu geprüft); fremde Termine ergeben 404. Schreiben geht nicht, Essenswunsch und Allergien einzelner Personen gibt die API bewusst nicht heraus (nur die Zahl der Personen mit Allergien). Gast-Tokens (`rsvp_…`, `/api/v1/…`) und Verwaltungs-Tokens liegen in getrennten Tabellen und gelten nie für die jeweils andere API.
* **Gruppen- & Vereins-Features:**
  * **Transparente Gästeliste:** Optional zuschaltbare öffentliche Gästeliste, auf der Teilnehmer sehen können, wer zugesagt hat, wer Begleitungen mitbringt und wer welches Essen/Getränk beisteuert. Sensible Daten (E-Mail, Telefon) werden streng gefiltert. Die Client-API liefert bei sichtbarer Gästeliste je Termin nur die Summen (`responses: { yes, no, waitlist, persons }`, gezählt wie in der Verwaltung), nie Namen; ohne sichtbare Gästeliste `responses: null`.
  * **Event-PIN:** Schütze private Events mit einem Zugangscode vor unbefugten Aufrufen.
* **Kapazitätsgrenzen & intelligente Warteliste:**
  * Optionale maximale Teilnehmerzahl pro Event festlegbar.
  * Vollautomatische Warteliste: Sobald das Limit erreicht ist, reihen sich neue Gäste nahtlos in die Warteschlange ein (inkl. Wartelisten-Info per E-Mail).
  * Auto-Nachrücken: Sagt ein Gast ab oder erhöht die Veranstalter:in die Kapazität, rücken wartende Gäste automatisch chronologisch nach und erhalten ihr Ticket per Mail.
  * Override durch die Verwaltung: Manuelles Zulassen von Gästen ("VIPs") an der Warteliste und Kapazitätsgrenze vorbei.
* **Übersichtliche Verwaltung:** Die Startseite listet anstehende Events, Reihen (mit den nächsten Terminen) und eingeklappt die vergangenen, jeweils mit Zusagen, Personen, Kapazität, Warteliste, offenen Einladungen und offenen Zahlungen. Jedes Event hat eine eigene Seite mit Reitern: Übersicht (Kennzahlen, Link für Gäste, CSV, Erinnerungen), Gäste (Filter, Suche, Details aufklappbar, auf dem Handy als Karten), je nach Event Einladungen, Küche und Zahlungen, sowie Einstellungen in einklappbaren Abschnitten. Was sich ausschließt (z. B. „Nur mit Einladung“ und PIN, E-Mail-Bestätigung oder Ticketkategorien; Begleitungen und Ticketkategorien) oder etwas anderes braucht (Erinnerung an Einladungen braucht eine Antwortfrist), sperrt das Formular gleich mit Hinweis; ungültige Eingaben meldet es beim Speichern, ohne die Eingaben zu verlieren. „Neues Event“ fragt nur Grunddaten und die Art ab (offene Anmeldung, Feier, Hochzeit mit Einladungen, Ball mit Tickets) und setzt passende Grundeinstellungen. Konzept: [docs/KONZEPT-OBERFLAECHE.md](docs/KONZEPT-OBERFLAECHE.md).
* **Dynamische Formulare:** Bestimme pro Event, welche Felder deine Gäste ausfüllen sollen:
  * Begleitungen: „bis zu N“ pro Event/Termin (0–20), jede mit Name, Altersgruppe (erwachsen, Kind, Kleinkind) und - wenn abgefragt - eigenem Essenswunsch und Allergien. Plätze zählen Personen (Kleinkinder nicht): Eine Anmeldung bekommt nur als Ganzes einen festen Platz, sonst kommt sie ganz auf die Warteliste; eine zu große Gruppe blockiert die Einzelnen dahinter nicht. Wer mit festem Platz Personen hinzufügen will, für die kein Platz mehr ist, bekommt eine Fehlermeldung, weniger Personen lassen Wartende nachrücken. Die Verwaltung kann Begleitungen über das Höchstmaß hinaus eintragen. Sichtbar in der Gästeliste, beim Einlass, im CSV-Export (Spalten „Personen“, „Begleitungen“) und bei Seating (alle Personen außer Kleinkindern). Nicht zusammen mit Ticketkategorien. Konzept: [docs/KONZEPT-EINLADUNGEN.md](docs/KONZEPT-EINLADUNGEN.md).
  * Essenspräferenzen (Vegan, Vegetarisch, Allesesser) & Allergien
  * Menüwahl pro Person (optional): Gänge mit Auswahl im Abschnitt „Menü“ (eine Zeile pro Gang: `Hauptgang: Fisch; Fleisch; Vegetarisch`). Jede Person mit Zusage außer Kleinkindern wählt pro Gang eine Option (Pflicht). Gänge und Optionen, die schon gewählt wurden, lassen sich nicht mehr entfernen. Die **Küchenübersicht** (`/admin/kueche/[eventId]`, für alle mit Zugriff auf die Gästeliste) zählt die Wahl pro Gang nach Erwachsenen und Kindern, listet Essen, Allergien und alle Personen nach Sitzplatz, mit Seating als **Küchenliste pro Tisch** (Wahl pro Gang, Allergien und Namen je Tisch), ist druckbar und hat eine Personen-CSV (`/api/export/kueche`). Die Client-API liefert `menuCourses` und nimmt `menu` bzw. `companions[].menu` (`{Gang-ID: Option}`) an.
  * Alkohol-Präferenz, pro Person: Bei Begleitungen und Haushalten wird jede erwachsene Person einzeln gefragt (Kinder nicht). Zu sehen in den Details der Gästeliste, beim Einlass (für Bändchen), in der Küche („Getränke: 12 mit Alkohol · 3 nur alkoholfrei“) und in beiden CSVs; die Client-API nimmt `companions[].drinksAlcohol` an.
  * Mitbringsel (Essen/Trinken)
  * E-Mail und Handynummer
* **Einladungen pro Haushalt (optional, z.B. für eine Hochzeit):** Schalter „Nur mit Einladung“ pro Einzel-Event oder für eine ganze Reihe (nicht zusammen mit PIN, E-Mail-Verifizierung, Konto-Pflicht oder Ticketkategorien). **Reihen** (z.B. Polterabend, Standesamt, Feier, Brunch): eine Einladungsliste im Reiter „Einladungen“ der Reihe, ein Link pro Haushalt (`/reihe/{slug}?token=…`) für alle oder ausgewählte Termine, Antwort pro Termin und Person, Mail mit allen Terminen, Druckliste, Erinnerung pro Termin. Unter „💌 Einladungen verwalten“ (`/admin/einladungen/[eventId]`) legt ihr Haushalte an, viele auf einmal per Textfeld (`Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind), Dora (Kleinkind); +1`), ändert sie (der Link bleibt, eine umbenannte Person behält ihre Antwort) oder löscht sie. Jeder Haushalt hat einen persönlichen Link (`/{slug}?token=…`), per Mail verschickt (Owner/Admin) oder über die **Druckliste mit QR-Codes** (`/admin/einladungen/[eventId]/druck`) für gedruckte Karten. Über den Link sagt der Haushalt **pro Person** zu oder ab, korrigiert Namen, wählt Essen, Allergien und Menü pro Person und trägt bis zu „+N“ weitere Personen ein. Ohne Link zeigt die Seite nur den Titel, Antworten und Kalenderdatei lehnt der Server ab. Die Übersicht zeigt den Stand pro Haushalt und Person mit Summen. Plätze zählen wie bei Begleitungen Personen (Kleinkinder nicht). Personen einer Haushalts-Antwort ändert die Verwaltung über den Einladungslink, nicht über „Antwort bearbeiten“. Konzept: [docs/KONZEPT-EINLADUNGEN.md](docs/KONZEPT-EINLADUNGEN.md).
* **Antwortfrist (optional):** Datum pro Event/Termin („Bitte antwortet bis …“). Danach ist das Formular für Gäste nur noch lesbar und der Server lehnt Antworten ab (auch über die Client-API); die Verwaltung kann weiter ändern, Nachrücken läuft weiter, Daten löschen geht immer. Im Einladungsmodus erinnert der Cron `/api/cron/reminders` optional X Tage vor der Frist einmal alle Haushalte mit E-Mail, die noch nicht geantwortet haben, dazu ein Knopf auf der Einladungsseite (Owner/Admin).
* **Freie Zusatzfragen:** Bis zu 3 frei definierbare Textfragen pro Event/Termin (z.B. "Welchen Song wünschst du dir vom DJ?"), die dynamisch im Gästeformular erscheinen. Antworten landen in der Gästetabelle der Verwaltung und im CSV-Export.
* **Double-Opt-In (Verifizierung):** Optional zuschaltbare E-Mail-Bestätigung für Gäste, um Spam-Anmeldungen zu verhindern und korrekte Adressen sicherzustellen.
* **Automatischer E-Mail-Versand:** Gäste erhalten nach der Zusage eine automatische Bestätigungsmail inkl. iCal-Datei und personalisiertem Link zur nachträglichen Bearbeitung.
* **Erinnerungs-Mails (Reminders):** 
  * Manueller Versand aus dem Dashboard an alle Zusagen (inkl. optionaler Zusatzinfos für die Gäste).
  * Vollautomatischer Versand X Tage vor dem Event (gesicherter Endpoint für Uptime Kuma oder Cronjobs).
* **QR-Code Einlasskontrolle (optional, standardmäßig aus):** Pro Event/Termin zuschaltbar für Veranstaltungen mit echtem Einlass. Bestätigte Gäste bekommen einen persönlichen QR-Code (Bestätigungsmail & Erfolgsseite), der beim Scannen automatisch als "anwesend" markiert wird. Eingecheckt wird **pro Person**: Der Scan lässt alle zusagenden Personen der Antwort herein und zeigt sie mit Altersgruppe und Alkohol; einzelne lassen sich danach aus- und wieder eintragen (kommt jemand später). Die Verwaltung zeigt eine Live-Statistik ("Eingecheckt 25/50 Personen") und erlaubt auch manuelles Ein-/Auschecken ohne Scan, für die ganze Antwort oder pro Person. Ändert ein Gast nach dem Einlass seine Antwort, bleibt der Einlass erhalten. Für die meisten privaten Feiern ohne Einlasskontrolle bleibt diese Option einfach deaktiviert.
  * **Kommen und Gehen (optional, eigene Option „Kommen und Gehen protokollieren“, nur mit QR-Einlass):** für Sitzungen und Versammlungen (Idee L7, Vorlage „Sitzung oder Versammlung“). Auschecken heißt dann „geht“ statt „war nicht da“: Die Person bleibt „da gewesen“ (Feedback, Statistik), die Gästeliste zeigt „🚪 Weg seit 20:15“, und ein erneuter Scan oder Klick checkt sie wieder ein. Jedes Kommen, Gehen und Wiederkommen landet mit Uhrzeit im Protokoll (`PresenceEntry`, pro Person). Reiter **„Anwesenheit“**: wer gerade da ist, alle Aufenthalte pro Person („19:02–20:15, 20:40–“), der Verlauf („20:15 Ben geht“), druckbar und als CSV (`/api/export/anwesenheit`), aktualisiert sich alle 15 Sekunden. Die Übersicht zeigt „Jetzt da 12/20“. Fehlscans nimmt „Letzte Änderung zurücknehmen“ auf der Scan-Seite zurück (eine Änderung = alle Einträge mit demselben Zeitpunkt). Logik in `app/lib/checkin.ts`.
* **Sitzplätze über Seating (optional):** Pro Termin mit einem Event im Sitzplatz-Tool Seating verknüpfbar. Zugesagte Gäste bekommen „Sitzplatz wählen“ (Seite, Erfolgsseite, Bestätigungsmail), Änderungen an Zusagen gehen automatisch an Seating, und der zugewiesene Platz erscheint als „Dein Platz: …“, beim Einlass und im CSV-Export - siehe [Verknüpfung mit Seating](#-verknüpfung-mit-seating-sitzplätze).
* **Schichten (optional):** Pro Termin mit einem Event in Schichten (Dienste und Schichten, eigenes Tool) verknüpfbar. Helfer\*innen mit genug Schichten bekommen automatisch eine Zusage, in der Ticketkategorie ihrer Stufe („ab 1 Schicht: Helfer\*innen, ab 5: Helfer\*innen plus“) - siehe [Verknüpfung mit Schichten](#-verknüpfung-mit-schichten).
* **Zeitplan (optional):** Pro Termin mit einem Event im Zeitplan-Tool (Ablauf großer Events) verknüpfbar. Zugesagte Gäste bekommen „Zeitplan“ (Seite, Erfolgsseite, Bestätigungsmail) und sehen damit den aktuellen Ablauf; bei Absage oder Löschung endet ihr Zugang dort automatisch. An den Zeitplan gehen nur Kennungen, keine Namen oder Adressen - außer der Termin gibt Kommen und Gehen bzw. die Beschlüsse einer Sitzung einzeln für den Rückblick frei (nur angezeigt, nicht gespeichert) - siehe [Verknüpfung mit Zeitplan](#-verknüpfung-mit-zeitplan).
* **Wunschliste (optional, z.B. für eine Hochzeit):** Schalter „Wunschliste“ pro Event/Termin, Wünsche im Reiter „Wünsche“: Geschenke mit Anzahl, Link und ungefährem Preis oder **Geldwünsche mit Zielbetrag**, an denen sich mehrere mit Teilbeträgen beteiligen. Gäste reservieren über ihren persönlichen Link (nach einer Antwort bzw. mit Einladung) und sehen nur den Stand, nie wer was schenkt; mehr Stück als frei verhindert eine atomare SQL-Anweisung, auch bei gleichzeitigen Reservierungen. Mit „Überraschung“ (Standard) sieht auch die Verwaltung keine Namen. Die Art „Hochzeit“ schaltet die Wunschliste gleich ein. Konzept: [docs/KONZEPT-WUNSCHLISTE.md](docs/KONZEPT-WUNSCHLISTE.md).
* **Mitbringliste (optional):** Pro Event/Termin Einträge mit Anzahl (Abschnitt „Mitbringliste“ im Formular, eine Zeile pro Eintrag: `2x Salat`, `Nachtisch`). Gäste mit Zusage kreuzen beim Antworten an, was sie übernehmen („Salat 1/2“); volle Einträge sind gesperrt, auch serverseitig und bei gleichzeitigen Zusagen (`app/lib/bring-list.ts`, eine atomare SQL-Anweisung). Absage oder Warteliste geben Einträge frei, ein aus der Liste entfernter Eintrag nimmt seine Beanspruchungen mit. Sichtbar in der Gästeliste („Bringt mit“), in der Verwaltung (Stand je Eintrag) und im CSV-Export, zusammen mit dem Freitext „Mitbringsel“. Die Client-API (`/api/v1`) lässt bestehende Beanspruchungen unverändert. **Vorlage für Reihen** (`EventSeries.bringTemplate`, Einstellungen der Reihe): Neue Termine bekommen die Liste und lassen sich danach einzeln ändern; auf Wunsch übernehmen auch kommende Termine ohne eigene Liste die Vorlage (bestehende Listen werden nie überschrieben). Im Termin speichert „Als Vorlage der Reihe speichern“ die Liste dieses Termins als neue Vorlage.
* **Tickets und Bezahlung (optional, z.B. für einen Ball):** Pro Event/Termin Kategorien mit Preis und Kontingent (Abschnitt „Tickets und Bezahlung“, eine Zeile pro Kategorie: `Studierende; 25; 120`, `Gäste; 35,50`, `Helfer*innen; 0; 20`). Gäste mit Zusage wählen eine Kategorie; eine volle Kategorie führt auf ihre Warteliste, ohne die anderen zu blockieren, und beim Nachrücken gilt für alle Wege eine Regel (`app/lib/waitlist.ts`). Bei Kategorien gibt es keine Begleitung, jede Person meldet sich selbst an. Kein Zahlungsanbieter: Mit Preis bekommen Gäste Betrag, Empfänger\*in, IBAN, einen eindeutigen Verwendungszweck und einen **GiroCode** (EPC-QR zum Scannen in der Banking-App) auf der Erfolgsseite, über ihren persönlichen Link und in der Bestätigungsmail. In der Gästeliste markieren Owner, Admins und freigegebene Moderator\*innen Zahlungen als *bezahlt* (Überweisung, der Gast bekommt eine Bestätigungsmail) oder *bar*. Optional gibt es eine Zahlfrist (nur Anzeige: überfällige Zusagen lassen sich per Klick stornieren, nichts verfällt automatisch), eine automatische **Zahlungserinnerung** X Tage vor Fristende (Mail mit GiroCode und Push, über den Cron `/api/cron/reminders`, oder per Knopf an alle offenen) und eine Erstattung als Status nach einer Absage. **Kontoauszug abgleichen** (`/admin/zahlungen/[eventId]`): Umsatz-Export der Bank hochladen (CSV in beliebigem Bankformat oder CAMT.053-XML), rsvp-app findet die Verwendungszwecke, prüft den Betrag, zeigt eine Vorschau und markiert erst nach Bestätigung; die Datei wird nicht gespeichert (`app/lib/bank-import.ts`). Beim Einlass zeigt der Scan Kategorie und Zahlstatus; ist noch etwas offen, checkt er nicht automatisch ein, sondern bietet „Bar kassiert – einlassen“ (Abendkasse). Mit Seating lässt sich die Sitzplatzwahl bis zur Zahlung sperren. Kategorie, Betrag, Verwendungszweck und Zahlstatus stehen auch im CSV-Export; die Client-API nimmt `ticketCategoryId` an und liefert die Zahlungsdaten zurück. Konzept: [docs/KONZEPT-TICKETS.md](docs/KONZEPT-TICKETS.md).
* **Fotoalbum (optional):** Pro Event/Termin ein Foto-Link (`Event.photoUrl`, Abschnitt „Fotos“ im Formular), z.B. ein geteiltes Immich-Album mit Upload-Freigabe. Gäste mit Zusage (nicht auf der Warteliste) sehen „📷 Fotos ansehen und eigene hochladen“ auf ihrer persönlichen Seite, aber erst ab dem Ende des Termins (Beginn + Dauer). Nur `http(s)`-Links, geprüft in `app/lib/photo-link.ts`; rsvp-app speichert nur den Link.
* **Sitzung im Abstimmungstool (optional, Idee L7):** Pro Event/Termin der Link einer Sitzung (`Event.assemblyUrl`, Abschnitt „Verknüpfungen“, nur mit `ABSTIMMUNGSTOOL_BASE_URL` und `POLL_VERIFICATION_SECRET`). Gäste mit Zusage, die zählt, sehen „🗳️ Zur Sitzung“ (`/api/assembly-link/[eventId]`, Nachweis `assembly-access` mit Name und einem Pseudonym je Sitzung, 15 Minuten, keine E-Mail). Das Abstimmungstool fragt bei jeder Stimme ab, wer gerade da ist (`POST /api/assembly/roster`, signiert in beide Richtungen; Antwort: Pseudonyme der Eingecheckten, die nicht gegangen sind, Zahl der Zusagen, ob QR-Einlass) - beantwortet nur für den Termin, der genau diese Sitzung verlinkt. Die **Sitzungsleitung** im Abstimmungstool holt die Anwesenheitsliste mit Namen (`POST /api/assembly/attendance`, Nachricht `assembly-attendance`: alle Zusagen, die zählen, mit Pseudonym, Name, da, gegangen - keine E-Mail, keine Rsvp-ID) und checkt ohne Scan ein und aus (`POST /api/assembly/presence`, Nachricht `assembly-presence` mit Pseudonym und Zielzustand `present`; wirkt wie der Knopf in der Gästeliste, also mit „Kommen und Gehen“ samt Protokoll; nur mit QR-Einlass, sonst 409). Dasselbe nutzen Mitglieder, wenn die Sitzung „selbst einchecken“ erlaubt. Beim Speichern meldet rsvp-app die Verknüpfung (`assembly-link`); gehört die Sitzung schon zu einem anderen Termin oder gibt es sie nicht, bricht das Speichern mit Meldung ab, ist das Abstimmungstool nicht erreichbar, verknüpft es sich beim ersten Beitritt. Konzept: abstimmungstool `docs/KONZEPT-SITZUNG.md`, Logik in `app/lib/assembly.ts`.
* **Feedback nach dem Event (optional):** Pro Event/Termin ein Fragebogen im abstimmungstool. Gäste mit Zusage (mit QR-Einlass nur Eingecheckte) sehen ab dem Ende „📝 Feedback geben“ und bekommen den Link einstellbar per Mail und Push - eine Antwort pro Gast, dort nur unter einem Pseudonym (siehe „Feedback-Fragebogen nach dem Event“).
* **Darkmode:** folgt der Systemeinstellung des Geräts, nur am Bildschirm (`@custom-variant dark` in `app/globals.css`) – Ausdrucke bleiben immer hell. Gleiche Regel in allen Tools der Suite.
* **Web-Push-Benachrichtigungen (PWA):** Sowohl die Verwaltung als auch die Gast-Seiten sind als installierbare PWA konfiguriert. Verwaltungskonten können sich pro Gerät anmelden und werden sofort informiert, sobald ein Gast eine neue Zu- oder Absage abgibt. Gäste können sich direkt auf ihrer Antwort-Seite ("🔕 Push-Benachrichtigungen aktivieren"-Button) anmelden - ganz ohne eigenes Konto - und bekommen dann Erinnerungen sowie kurzfristige Termin-Änderungen (Uhrzeit/Ort/Titel/Beschreibung) auch als Push, nicht nur per Mail.
* **Verwaltung (Dashboard):** 
  * Volle Übersicht über alle Zu- und Absagen sowie Wartelistenplätze.
  * Status-Anzeige ausstehender E-Mail-Verifizierungen.
  * Nachträgliches, manuelles Bearbeiten von Gästedaten (z.B. bei telefonischer Zusage).
  * CSV-Export der kompletten Gästeliste mit einem Klick.
  * Geschützt durch individuelle Verwaltungskonten (E-Mail + Passwort).

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

# VAPID-Keys für Web-Push-Benachrichtigungen (Verwaltung UND Gast-Seiten teilen sich
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
# mit POLL_VERIFICATION_SECRET und einem gesetzten pollUrl. Zugleich der einzige Origin,
# dessen Terminabstimmungen ein Datum setzen dürfen (siehe "Terminabstimmung").
ABSTIMMUNGSTOOL_BASE_URL=https://vote.deine-domain.de

# Anbindung an Seating (Sitzplatz-Tool, eigenständiges Projekt) - siehe Abschnitte
# "Verknüpfte Tools" und "Verknüpfung mit Seating" unten. Secret identisch zu
# RSVP_SEATING_SECRET in Seating, mind. 32 Zeichen, nie das Secret einer anderen Anbindung.
SEATING_SECRET=...
SEATING_BASE_URL=https://plaetze.deine-domain.de

# Anbindung an das Zeitplan-Tool (eigenständiges Projekt) - siehe "Verknüpfung mit Zeitplan"
# unten. Secret identisch zu RSVP_TIMELINE_SECRET im Zeitplan, mind. 32 Zeichen, eigenes Secret.
TIMELINE_SECRET=...
TIMELINE_BASE_URL=https://zeitplan.deine-domain.de

# Anbindung an Schichten (eigenständiges Projekt) - siehe "Verknüpfung mit Schichten" unten. Secret identisch zu
# RSVP_SHIFTS_SECRET in Schichten, mind. 32 Zeichen, eigenes Secret.
SHIFTS_SECRET=...
SHIFTS_BASE_URL=https://schichten.deine-domain.de
```

> **Impressum-Platzhalter:** Die Impressum-Seite (`app/impressum/page.tsx`) liest ihre Angaben zur Laufzeit aus `IMPRESSUM_NAME`/`IMPRESSUM_STREET`/`IMPRESSUM_ZIP`/`IMPRESSUM_CITY`/`IMPRESSUM_EMAIL`/`IMPRESSUM_PHONE`. Sind diese Variablen nicht gesetzt, zeigt die Seite generische Platzhalter (`[Dein Vorname] [Dein Nachname]` etc.) statt echter Daten an. So bleibt das Repository frei von personenbezogenen Daten - trag deine echten Angaben ausschließlich in deine eigene, nicht versionierte `.env` ein (lokal wie auf dem Server).

> **VAPID-Keys generieren:** Für die Web-Push-Benachrichtigungen brauchst du ein eigenes Schlüsselpaar. Einmalig generieren mit:
> ```bash
> node -e "console.log(require('web-push').generateVAPIDKeys())"
> ```
> `VAPID_PUBLIC_KEY` ist unkritisch (wird an den Browser ausgeliefert), `VAPID_PRIVATE_KEY` ist ein Geheimnis wie `SMTP_PASS`. Sind die Keys nicht gesetzt, bleiben beide Push-Features (Verwaltung und Gast-Seiten) einfach inaktiv (kein Push-Button sichtbar) - der Rest der App läuft unverändert weiter.

> **Erstes Verwaltungskonto anlegen:** Es gibt keine öffentliche Registrierung. Dein allererstes Konto legst du einmalig per Skript an:
> ```bash
> node create-user.js deine-email@domain.de ADMIN
> # oder im laufenden Docker-Container:
> docker compose run --rm rsvp-app node create-user.js deine-email@domain.de ADMIN
> ```
> Das Passwort (mind. 10 Zeichen) wird verdeckt abgefragt, damit es weder im Shell-Verlauf noch in der Prozessliste landet. Die Rolle ist optional (Standard: Creator) - mit `ADMIN` entfällt der separate `set-role.js`-Schritt unten. Nicht-interaktiv geht auch `PASSWORD=... node create-user.js ...`.
> Danach kannst du dich unter `/admin/login` einloggen und über "+ Konto anlegen" im Dashboard weitere Konten für andere Referate/Freunde erstellen - `create-user.js` brauchst du dann nicht mehr.
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

Der Container (`node:22-alpine`) läuft wie in den anderen Tools der Suite als unprivilegierter Nutzer `node` (UID 1000), nicht als root. Das
Datenverzeichnis muss ihm gehören, vor dem ersten Start also `mkdir -p data && sudo chown 1000:1000 data`. Ältere
Installationen liefen als root; dort einmalig vor dem Update umstellen, ohne `sudo` z.B. über Docker:
`docker run --rm -v "$PWD/data:/d" alpine chown -R 1000:1000 /d`.

Der Port (`3005`) ist nur an `127.0.0.1` gebunden: Von außen kommt alles über den Cloudflare-Tunnel (`cloudflared` auf
dem Host, Ziel `http://127.0.0.1:3005`). Auf allen Schnittstellen wäre die App über die öffentliche IPv6 des Servers am
Tunnel vorbei erreichbar, mit selbst gesetztem `X-Forwarded-For` und damit an der IP-Drosselung vorbei. Für die interne
Überwachung tritt der Container zusätzlich dem Docker-Netz `proxy_net` bei; Uptime Kuma prüft dort `http://rsvp-app:3000`.

## ⏰ Automatische Erinnerungen (Cronjob / Uptime Kuma)

Um automatische E-Mail-Erinnerungen für Events zu versenden, muss der folgende Endpoint regelmäßig (z.B. stündlich) über einen Dienst wie Uptime Kuma aufgerufen werden. Das System prüft dann selbstständig, ob für ein anstehendes Event Mails verschickt werden müssen:

`GET https://rsvp.deine-domain.de/api/cron/reminders?secret=DeinSehrGeheimesPasswort123`

## 🗑️ Automatische Datenlöschung (Cronjob / Uptime Kuma)

Zur Umsetzung der Speicherbegrenzung nach DSGVO gibt es einen zweiten, unabhängigen Endpoint, der ebenfalls regelmäßig aufgerufen werden sollte (hier reicht z.B. einmal täglich statt stündlich). Er löscht automatisch Events (inkl. Datensatz) 18 Monate nach dem Veranstaltungsdatum sowie Teilnehmendenkonten ("Mein Konto"), die seit 2 Jahren nicht mehr eingeloggt wurden - siehe `/datenschutz` Punkt 15 für die genauen Regeln. Löscht jemand vorher einen Termin, eine einzelne Antwort oder ein Konto im Dashboard, verschwinden die dadurch verwaisten Gastprofile (Name, Kontaktdaten, Ernährung, Allergien, persönlicher Link, Push-Abos) sofort mit (`app/lib/participants.ts`); Gäste mit einer Antwort zu einem anderen Termin behalten ihr Profil. Der Cron räumt nur noch Altlasten auf:

`GET https://rsvp.deine-domain.de/api/cron/cleanup?secret=DeinSehrGeheimesPasswort123`

## 🗳️ Verknüpfung mit dem separaten "abstimmungstool"

Ein Event/Termin kann optional auf eine Abstimmung im separaten `abstimmungstool`-Projekt verlinken (`Event.pollUrl`/`pollLabel`, gesetzt beim Anlegen/Bearbeiten). Ist dort zusätzlich `requireRsvpVerification` für diese Abstimmung aktiviert, greift eine tiefere Kopplung:

* **Nur Zusagende können abstimmen, Absagen werden direkt blockiert:** Der Verifizierungs-Token, der beim Klick auf den Abstimmungs-Link mitgeschickt wird, trägt neben der E-Mail auch den *aktuellen* RSVP-Status für diesen Termin (`app/lib/poll-verification.ts`, `app/api/poll-link/[eventId]/route.ts`) - bei jedem Klick frisch ermittelt. Eine nachträglich erteilte Zusage schaltet sich dadurch beim nächsten Linkaufruf von selbst wieder frei.
* **Auch über die Client-API:** `GET /api/v1/termine` meldet je Termin `poll: { label } | null`, `GET /api/v1/termine/[id]/abstimmung` gibt mit API-Token denselben persönlichen Link wie der Knopf auf der Seite (`{ url, label, verified, attending, expiresAt }`, gemeinsame Logik in `app/lib/poll-link.ts`) - nur für Termine eigener Reihen und nur mit bestätigtem Konto. So kann z.B. ein Chat-Bot den Link nur der Person selbst zeigen.
* **Nachträgliche Absage entfernt eine bereits abgegebene Stimme:** Bei jeder Zu-/Absage-Änderung wird zusätzlich aktiv ein signierter Webhook ans abstimmungstool geschickt (`app/lib/poll-notify.ts`, aufgerufen aus `performRsvpSubmission`) - unabhängig davon, ob die Person die Abstimmung danach nochmal aufruft. Best-effort mit 5s-Timeout, ein nicht erreichbares abstimmungstool blockiert niemals die eigentliche RSVP-Abgabe.
* **Ergebnis-Anzeige nach Schließung:** Schließt sich die verknüpfte Abstimmung (manuell oder automatisch), meldet abstimmungstool das Ergebnis zurück (`app/api/poll-result-webhook/route.ts`), gespeichert auf `Event.pollResult` und angezeigt als Banner auf der Event-Seite (`app/ui/poll-result-banner.tsx`). Optional trägt die Meldung `quorumMet` (false → Banner "Nicht beschlussfähig") und `unit` (`points` → "Punkte" statt "Stimmen", bei Abstimmungsarten mit Wertung); fehlen sie (ältere abstimmungstool-Version), gilt beschlussfähig und Stimmen.

### Terminabstimmung: Datum per Abstimmung festlegen

Ein Event kann sein Datum aus einer Terminabstimmung im abstimmungstool bekommen (`app/lib/poll-date.ts`,
`POST /api/poll-date`):

* **"Datum noch offen"** (`Event.datePending`, Häkchen im Abschnitt "Externe Abstimmung", nur zusammen mit einem
  Abstimmungslink): Das Datum im Formular ist dann nur ein Platzhalter (bitte in der Zukunft) - keine Erinnerungen,
  kein Kalender-Anhang, `/api/ical` antwortet 404, Mails/Push/Listen zeigen "Datum wird noch abgestimmt"
  (`app/lib/event-date.ts`), die Client-API liefert `date: null` und `datePending: true`.
* **Festlegen passiert im abstimmungstool, nie automatisch:** Dort bestätigt die Verwaltung ein eindeutiges
  Ergebnis bzw. entscheidet bei Gleichstand. Dann meldet es den Termin hierher. Alle Events, deren `pollUrl` auf
  **genau diese** Abstimmung des eingerichteten abstimmungstools zeigt (Origin = `ABSTIMMUNGSTOOL_BASE_URL`) und
  deren Datum offen ist, übernehmen ihn (`icsSequence` +1); wer zugesagt hat (auch Warteliste), bekommt die
  Änderungs-Mail samt Kalender-Anhang und Push - wie bei "Teilnehmende benachrichtigen". Dass die Event-Verwaltung
  den Abstimmungslink gesetzt hat, ist zugleich ihre Zustimmung. Events mit festem Datum bleiben unangetastet.
* **Neues Event:** Zeigt noch kein Event auf die Abstimmung und wünscht die Verwaltung dort eins, legt rsvp-app es an
  - nur für den Owner der Abstimmung und nur, wenn dessen Konto über den Suite-Verbund mit einem Konto hier
  verknüpft ist (`ExternalIdentity` mit dem abstimmungstool als Anbieter, oder umgekehrt: das abstimmungstool
  schickt unsere Konto-ID mit, die es aus einer von uns signierten Anmeldung kennt) und dieses Konto eigene Events
  besitzen darf (nicht MODERATOR). Titel und Datum kommen aus der Abstimmung, der Rest (Ort, Fragen, ...) wird hier
  nachgetragen. Das neue Event trägt den Abstimmungslink - eine wiederholte Meldung legt so kein zweites an.
* **Keine doppelten Benachrichtigungen:** Das abstimmungstool benachrichtigt seine Abstimmenden selbst und schickt
  SHA-256-Hashes dieser Adressen mit (`skipEmailHashes`); diese Gäste bekommen hier weder Mail noch Push
  (`app/lib/event-change-notify.ts`). Wer über rsvp-app abgestimmt hat, wird dagegen von hier benachrichtigt.
* **Vertrag:** gleiches Format und Secret wie die übrigen Nachrichten (siehe „Nachrichtenformat“ unten), Arten
  `poll-date-status` und `poll-date-set`, höchstens 15 Minuten gültig (`verifyPollDateMessage` in
  `app/lib/poll-verification.ts`). Gegenstück im abstimmungstool: `app/lib/rsvp-date.ts`.

Alle drei Punkte sind rein additiv und benötigen `POLL_VERIFICATION_SECRET` + `ABSTIMMUNGSTOOL_BASE_URL` (siehe oben) - ohne beide bleibt nur der einfache, unverifizierte Link übrig, wie er schon vorher existierte.

**Nachrichtenformat der Kopplung:** Alle Nachrichten zwischen rsvp-app und abstimmungstool (Klick-Token `poll-access`,
Zu-/Absage `poll-attendance`, Ergebnis `poll-result`, Terminabstimmung `poll-date-*`, Fragebogen `survey-access`,
Sitzungen `assembly-*`) haben das gemeinsame Format der Suite (`signLinkMessage`/`verifyLinkMessage` aus `suite-kit`):
`base64url(JSON).base64url(HMAC-SHA256(payloadPart, POLL_VERIFICATION_SECRET))`, Nutzlast
`{ typ, aud, ...felder, iat, exp }`. `typ` hält die Arten auseinander, `aud` ist der Origin des Empfängers (beim
Klick-Token der Origin der Abstimmung), eingehende Nachrichten gelten höchstens 15 Minuten (nur der Fragebogen-Nachweis
12 Stunden, weil er das Ausfüllen überdauern muss). Beide Seiten haben dieselben festen Prüfnachrichten in ihren
Unit-Tests (`tests/unit/poll-verification.test.ts`, im abstimmungstool `tests/unit/rsvp-verification.test.ts`) - eine
Formatänderung geht nur in beiden Tools zugleich.

### Feedback-Fragebogen nach dem Event

Ein Termin kann auf einen Fragebogen im abstimmungstool verweisen (`Event.feedbackUrl`, Einstellungen → Verknüpfungen →
„Feedback-Fragebogen“; nur `<ABSTIMMUNGSTOOL_BASE_URL>/fragebogen/<id>`, dort mit „Gäste aus rsvp-app“ angelegt).
Regeln in `app/lib/feedback-link.ts`, Versand in `app/lib/feedback.ts`:

* **Wer:** eine Zusage, die zählt (nicht Warteliste, verifiziert falls verlangt); bei Terminen mit QR-Einlass nur, wer
  eingecheckt wurde. Ab dem Ende des Termins zeigt die persönliche Seite „📝 Feedback geben“.
* **Mail und Push:** `Event.feedbackDelayHours` (direkt, 3, 12, 24 oder 48 Stunden nach dem Ende, leer = nicht
  verschicken) - der Erinnerungs-Cron (`/api/cron/reminders`) schickt jeder Zusage einmal den Link
  (`Rsvp.feedbackSentAt`, vor dem Versand atomar gesetzt), höchstens eine Woche lang nach dem fälligen Zeitpunkt.
  Wer später eingecheckt wird, bekommt ihn beim nächsten Lauf.
* **Link:** Seite, Mail und Push führen nur auf `/api/feedback-link/[eventId]` (editToken oder verifizierte
  Gast-Sitzung, PIN wie bei den verknüpften Tools). Die Route leitet mit 303 (`no-store`, `no-referrer`) und einem
  frisch signierten Nachweis (`?verify=`, 12 Stunden gültig) zum Fragebogen weiter: Nachricht `survey-access` mit
  `surveyId` und `sub` (Format siehe „Nachrichtenformat der Kopplung“). `sub` ist ein Pseudonym (HMAC über Fragebogen und Rsvp-ID) -
  keine Kennung, kein Name, keine E-Mail. Gegenstück im abstimmungstool: `verifyRsvpSurveyToken`.
* Tests: `tests/unit/feedback-link.test.ts`, `tests/e2e/feedback.spec.ts`.

## 🔌 Verknüpfte Tools (Anbindungen)

Ein Termin kann mit Events in anderen, eigenständigen Tools der Suite verknüpft werden - **Seating** (Sitzplätze,
siehe unten), das **Zeitplan-Tool** (Ablauf des Events) und **Schichten** (Helfer\*innen), jeweils unten beschrieben. Alles Gemeinsame steht in `app/lib/linked-tools.ts`:

* **Liste der Tools** (`DEFINITIONS`): pro Tool-Typ die Env-Variablen für Adresse und Secret, die Form des Links auf ein
  Event dort (`<Adresse>/<Segment>/<Event-ID>`), der Name des ID-Felds in den Nachrichten und der Webhook-Pfad. Ein neues
  Tool ist ein neuer Eintrag; TypeScript verlangt dann den Webhook-Inhalt nach dessen Vertrag
  (`app/lib/linked-tools-notify.ts`) und das Aufräumen beim Neu-Verknüpfen (`app/lib/linked-tools-store.ts`).
* **Konfiguration nur in der `.env`:** je Tool `<PREFIX>_BASE_URL` und `<PREFIX>_SECRET` (Seating: `SEATING_BASE_URL`,
  `SEATING_SECRET`). Secrets stehen nie in der Datenbank. **Jedes Tool hat sein eigenes Secret:** Nachrichten werden pro
  Tool mit dessen Secret signiert bzw. geprüft, `aud` ist immer der Origin des Empfängers. Haben zwei Tools dasselbe Secret
  (oder ein Tool das `POLL_VERIFICATION_SECRET`), gelten **beide** als nicht eingerichtet (Warnung im Log).
* **Verknüpfung pro Termin** in der Tabelle `EventToolLink` (höchstens eine je Termin und Tool-Typ, wird mit dem Termin
  gelöscht). Ein Link wird beim Speichern nur mit genau der Adresse des Tools angenommen und bei **jeder** Verwendung erneut
  gegen die aktuelle Konfiguration geprüft - sonst könnte eine Creator\*in den Server Webhooks an beliebige Adressen
  schicken lassen.
* **Webhook `rsvp-change`** bei jeder Änderung einer Zusage an **alle** gültig verknüpften Tools des Termins, jeweils mit
  eigenem Inhalt, Secret und Empfänger; nicht verknüpfte, nicht eingerichtete oder unbekannte Tools bekommen nichts. Pro
  Tool in Reihenfolge, verschiedene Tools parallel, 5 s Timeout, erst nach der Antwort (`after()`).
* **Anlegen beim Tool** (Idee Q1, `app/lib/linked-create.ts`, Vertrag in suite-kit `src/linked-create.ts`): Ist ein
  Termin noch nicht mit dem Zeitplan bzw. mit Schichten verknüpft, zeigt „Verknüpfungen“ den Knopf „Im Zeitplan
  anlegen“ bzw. „In Schichten anlegen“ (Schichten nicht im Einladungsmodus). Vorher fragt rsvp-app das Tool
  (`event-create-status`, im Suspense-Rahmen, 5 s Timeout), ob das Konto dort anlegen darf. Das Event gehört dem Konto im
  Tool, das über den Konten-Verbund mit dem eigenen verknüpft ist (gesendet werden die eigene Konto-ID und, falls man
  sich hier über das Tool anmeldet, die Konto-ID dort); ohne Verknüpfung steht statt des Knopfs ein Anmelde-Link. Der
  Klick (`createLinkedToolEvent`, nur Owner und Admins) schickt Titel und Datum (`event-create`), das Tool legt einen
  Entwurf an und antwortet mit dem Link, den rsvp-app nur übernimmt, wenn er auf die Adresse des Tools zeigt. Gibt es
  dort schon ein Event zu diesem Termin, wird es verknüpft. Seating bleibt bei der Verknüpfung von Hand (braucht
  Raumplan, Modus und Ende).
* **Weiterleitungs-Routen** („Sitzplatz wählen“, „Zeitplan“) prüfen über `app/lib/linked-tools-access.ts`, wer
  weitergeleitet werden darf (editToken genau dieses Termins oder verifizierte Gast-Session, PIN, Zusage zählt), und
  stellen dann bei jedem Klick einen frischen, kurz gültigen Link nach dem Vertrag des Tools aus.

**Update von einer Version mit `Event.seatingUrl`:** Früher standen der Sitzplatz-Link und der Platzierungs-Stand in den
Spalten `Event.seatingUrl`/`seatingPlacementsAt`. Eine frühere Version hat sie einmalig nach `EventToolLink` übernommen
(`PRAGMA user_version` 2). Seit Oktober 2026 entfernt `migrate-drop-seating-columns.js` die beiden Spalten beim
Containerstart **vor** `prisma db push`, aber nur, wenn diese Übernahme gelaufen ist. Andernfalls bricht der Start mit
einem Hinweis ab, statt die Links zu verlieren. Wer von einer noch älteren Version kommt, startet deshalb erst einmal die
Vorgängerversion (Commit `ca1bd37`) und spielt danach das Update ein. Ein Rollback legt die Spalten leer wieder an, die
App liest sie ohnehin nicht. Lokal ohne Docker: `node migrate-drop-seating-columns.js && npx prisma db push && node
migrate-token-hashes.js && node migrate-tool-links.js && node migrate-persons.js && node migrate-person-details.js && node migrate-invitation-reminders.js`.

**Update auf Begleitungen (Oktober 2026):** `migrate-persons.js` (`PRAGMA user_version` 3, nach `prisma db push`) stellt
„Begleitperson (+1) abfragen“ (`formConfig.askPlusOne`) auf „bis zu 1 Begleitung“ (`Event.maxCompanions`) um und
überträgt vorhandene Begleitungen (`Rsvp.plusOne`/`plusOneName`) in die Personenliste (`RsvpPerson`). Die beiden alten
Spalten bleiben vorerst leer stehen und entfallen mit einem späteren Update.

**Update auf Alkohol und Einlass pro Person (Oktober 2026):** `migrate-person-details.js` (`PRAGMA user_version` 4)
überträgt die Alkohol-Angabe einer Antwort auf die anmeldende Person (bei Haushalten auf alle zusagenden Erwachsenen) und
den Einlass einer eingecheckten Antwort auf alle ihre zusagenden Personen.

**Update auf Einladungen für Reihen (Oktober 2026):** `migrate-invitation-reminders.js` (`PRAGMA user_version` 5)
überträgt „Erinnerung gesendet“ von der Einladung (`Invitation.reminderSentAt`) auf die neue Tabelle pro Termin
(`InvitationReminder`).

## 🪑 Verknüpfung mit Seating (Sitzplätze)

Ein Termin (Einzel-Event oder Reihen-Termin) kann optional mit einem Event im separaten Sitzplatz-Tool **Seating** verknüpft werden - für Tischbuchung/Platzwahl durch die Gäste oder eine Sitzordnung, die die Veranstalter\*innen in Seating selbst erstellen. Rein additiv: Ohne Sitzplatz-Link ändert sich nichts.

**Einrichtung**

1. In beiden `.env`-Dateien dasselbe Secret eintragen: hier `SEATING_SECRET`, in Seating `RSVP_SEATING_SECRET` (mind. 32 Zeichen, z.B. `openssl rand -hex 32`, **nicht** das `POLL_VERIFICATION_SECRET`). Dazu hier `SEATING_BASE_URL` (Adresse von Seating) und in Seating `RSVP_APP_BASE_URL` (Adresse dieser App, also `BASE_URL`).
2. **Beide Seiten stimmen zu:** In Seating in den Event-Einstellungen die ID des Termins eintragen (steht beim Bearbeiten des Termins im Abschnitt „Sitzplätze (Seating)“). Seating zeigt dann den Sitzplatz-Link `https://…/rsvp/<seating-event-id>` an, den Owner oder Admin hier beim Termin einträgt (nur `createEvent`/`updateEvent`/`updateSeriesTermin`, nicht im Schnell-Anlegen von Reihen-Terminen). Erst mit beiden Einträgen gilt die Verknüpfung. Links mit einem anderen Origin als `SEATING_BASE_URL` oder anderer Form werden beim Speichern abgelehnt. Gespeichert wird die Verknüpfung als `EventToolLink` vom Typ `seating` (siehe „Verknüpfte Tools“).

**Was passiert**

* **„Sitzplatz wählen“** erscheint auf der Gästeseite, auf der Erfolgsseite und in der Bestätigungsmail - nur für eine Zusage, die zählt (zugesagt, nicht auf der Warteliste, bei Double-Opt-In verifiziert, mit „Sitzplatzwahl erst nach Zahlung“ bezahlt bzw. kostenlos). Im letzten Fall sehen unbezahlte Zusagen einen Hinweis statt des Knopfs, und der Link kommt mit der Mail „Zahlung eingegangen“; Webhook und Gästeliste für Seating behandeln sie bis dahin wie nicht zugesagt. Der Link zeigt auf `/api/seating-link/[eventId]` (`app/api/seating-link/[eventId]/route.ts`), das die Person selbst nachweist (editToken einer Zusage genau dieses Termins **oder** aktive, verifizierte Gast-Session), die PIN beachtet und bei jedem Klick einen frischen, 15 Minuten gültigen `seat-link` ausstellt, bevor es auf `<Sitzplatz-Link>?t=…` weiterleitet.
* **Webhook bei jeder Änderung einer Zusage** (neu, geändert, abgesagt, Warteliste, nachgerückt, verifiziert, Name/Begleitung geändert, gelöscht - auch über die Admin-Aktionen und beim Löschen ganzer Events/Reihen/Konten): `POST <Seating>/api/rsvp-webhook` mit `rsvp-change` (`app/lib/linked-tools-notify.ts`, Inhalt `seatingRsvpChange` in `app/lib/seating.ts`). Läuft über `after()` erst nach der Antwort, mit 5 s Timeout - ein nicht erreichbares Seating verzögert oder blockiert nie eine RSVP-Abgabe. Verlorene Meldungen heilt Seatings Abgleich.
* **Gästeliste für Seating:** `POST /api/seating/guest-list` beantwortet eine signierte `guest-list-request` mit allen zählenden Zusagen (`rsvpId`, Name, E-Mail oder null, Begleitungen).
* **Platzierungen von Seating:** `POST /api/seating/placements` nimmt den vollständigen Stand `[{ rsvpId, label, persons? }]` entgegen, setzt `Rsvp.seatingLabel` (und, wenn Seating ihn kennt, Tisch und Platz pro Person in `Rsvp.seatingPersons` für die **Küchenliste pro Tisch**) für die genannten Zusagen und leert alle übrigen dieses Termins; eine ältere Meldung (`iat`) als die zuletzt angewandte wird ignoriert. Angezeigt als „Dein Platz: …“ auf der Gästeseite, groß beim Einlass (`/admin/checkin/[rsvpId]`) und als Spalte „Sitzplatz“ im CSV-Export. Das Label verschwindet mit der Rsvp; ein geänderter oder entfernter Sitzplatz-Link leert alle Labels des Termins.

**Vertrag** (`app/lib/seating.ts`, Gegenstück in Seating `app/lib/rsvp/token.ts`): `base64url(JSON).base64url(HMAC-SHA256(payloadPart, SEATING_SECRET))`. Jede Nachricht trägt `typ`, `aud` (Origin des Empfängers), `iat`/`exp` (Unix-Sekunden, höchstens 1 Stunde gültig), `seatingEventId` und `rsvpEventId` (= `Event.id` hier). Identität eines Gasts ist die `Rsvp.id`, nie die E-Mail.

| `typ` | Richtung | Weg | Inhalt |
| --- | --- | --- | --- |
| `seat-link` | rsvp-app → Seating | Browser: Redirect auf `<Sitzplatz-Link>?t=…` | `rsvpId`, `name`, `email` (oder null), `companions` |
| `rsvp-change` | rsvp-app → Seating | `POST <Seating>/api/rsvp-webhook`, `text/plain` | `rsvpId`, `attending`, `name`, `email`, `companions` |
| `guest-list-request` | Seating → rsvp-app | `POST /api/seating/guest-list`, `text/plain` | – |
| `guest-list` | rsvp-app → Seating | Antwort darauf, `text/plain` | `guests` |
| `placements` | Seating → rsvp-app | `POST /api/seating/placements`, `text/plain` | `placements`: vollständiger Stand `{ rsvpId, label, persons? }`, `persons`: `[{ key: "guest" \| "companion-N", table, seat }]` (optional; ungültige Angaben lehnen die ganze Meldung ab) |

`companions` sind die weiteren zusagenden Personen einer Antwort außer Kleinkindern (Name oder null, rsvp-app schickt höchstens 20). Die Endpunkte antworten mit 401 bei ungültiger Signatur, falscher Art, falschem Empfänger oder Ablauf, mit 404, wenn das Event nicht existiert oder seine Seating-Verknüpfung nicht genau auf die anfragende `seatingEventId` zeigt, und mit 413 bei zu großem Body (20 KB bzw. 2 MB).

## 🕒 Verknüpfung mit Zeitplan

Ein Termin kann optional mit einem Event im separaten **Zeitplan-Tool** verknüpft werden, das den Ablauf großer Events
(z.B. einer Hochzeit) mit Prognose zeigt. Im Zeitplan heißt der passende Zugang „Nur mit Zusage in rsvp-app“: Gäste
kommen dann nur mit einer gültigen Zusage hinein. Rein additiv: Ohne Zeitplan-Link ändert sich nichts.

**Einrichtung**

1. In beiden `.env`-Dateien dasselbe, **eigene** Secret eintragen: hier `TIMELINE_SECRET`, im Zeitplan
   `RSVP_TIMELINE_SECRET` (mind. 32 Zeichen, z.B. `openssl rand -hex 32`, **nie** das Secret von Seating oder dem
   Abstimmungstool - bei gleichem Wert gelten beide Anbindungen als nicht eingerichtet). Dazu hier `TIMELINE_BASE_URL`
   (Adresse des Zeitplans).
2. **Beide Seiten stimmen zu:** Im Zeitplan unter „Zugang für Gäste“ die ID des Termins eintragen (für den Zugang „Nur
   mit Zusage in rsvp-app“ Pflicht, sonst optional - z. B. nur fürs Protokoll im Rückblick) (steht hier beim Bearbeiten des Termins im Abschnitt „Zeitplan“). Der Zeitplan zeigt dann den
   Zeitplan-Link `https://…/rsvp/<zeitplan-event-id>` an, den Owner oder Admin hier beim Termin einträgt. Erst mit beiden
   Einträgen gilt die Verknüpfung. Links mit einem anderen Origin als `TIMELINE_BASE_URL` oder anderer Form werden beim
   Speichern abgelehnt. Gespeichert als `EventToolLink` vom Typ `timeline`.

**Was passiert**

* **„Zeitplan“** erscheint auf der Gästeseite, auf der Erfolgsseite und in der Bestätigungsmail - nur für eine Zusage,
  die zählt (zugesagt, nicht auf der Warteliste, bei Double-Opt-In verifiziert; dieselbe Regel wie bei Seating). Der
  Link zeigt auf `/api/timeline-link/[eventId]`, das die Person wie bei „Sitzplatz wählen“ nachweist (editToken genau
  dieses Termins oder verifizierte Gast-Session, PIN) und bei **jedem Klick** einen frischen, 10 Minuten gültigen
  `timeline-link` ausstellt, bevor es per `303` (`no-store`, `no-referrer`) auf `<Zeitplan-Link>?t=…` weiterleitet.
  Mails verlinken nur auf diese Weiterleitung, nie auf das Token.
* **Webhook bei jeder Änderung einer Zusage** an `POST <Zeitplan>/api/rsvp-webhook` (`rsvp-change`, gleiche Auslöser
  wie bei Seating). `attending: false` (Absage, Warteliste, fehlende Verifizierung, Löschung) beendet im Zeitplan die
  Gast-Sitzungen dieser Zusage.
* Der Zeitplan meldet nichts zurück.
* **Protokoll im Zeitplan-Rückblick (optional, Idee L7):** Zwei einzelne Häkchen unter dem Zeitplan-Link -
  „Kommen und Gehen im Zeitplan-Rückblick zeigen“ (`Event.timelinePresence`, sinnvoll mit „Kommen und Gehen
  protokollieren“) und „Beschlüsse der Sitzung im Zeitplan-Rückblick zeigen“ (`Event.timelineDecisions`, braucht eine
  Sitzung im Abstimmungstool). Der Rückblick fragt beim Öffnen signiert an (`POST /api/timeline/protocol`,
  `protocol-request`); geantwortet wird nur für den Termin, der genau dieses Zeitplan-Event verlinkt, und nur mit dem
  Freigegebenen: Kommen, Gehen und Wiederkommen mit Name und Uhrzeit (`PresenceEntry`) bzw. die geschlossenen
  Abstimmungen der Sitzung, die rsvp-app dafür beim Abstimmungstool abruft (`POST <Abstimmungstool>/api/assembly/decisions`,
  `assembly-decisions`, Secret `POLL_VERIFICATION_SECRET`; jedes Feld wird geprüft, bei geheimen Abstimmungen gehen nie
  Namen weiter). Der Zeitplan zeigt das beim Tagesordnungspunkt, der lief, und speichert es nicht. Logik in
  `app/lib/timeline-protocol.ts`.

**Vertrag** (`app/lib/timeline.ts`, Gegenstück im Zeitplan `app/lib/rsvp/token.ts`): Format wie bei allen verknüpften
Tools, `base64url(JSON).base64url(HMAC-SHA256(payloadPart, TIMELINE_SECRET))`, höchstens 1 Stunde gültig. **Keine
Namen, E-Mail-Adressen oder Begleitungen** - der Zeitplan braucht nur „diese Zusage gilt“. Einzige Ausnahme ist das
Protokoll, und nur, wenn der Termin es freigibt.

| `typ` | Richtung | Weg | Inhalt |
| --- | --- | --- | --- |
| `timeline-link` | rsvp-app → Zeitplan | Browser: `303` auf `<Zeitplan-Link>?t=…` | `aud`, `timelineEventId`, `rsvpEventId`, `rsvpId`, `iat`, `exp` |
| `rsvp-change` | rsvp-app → Zeitplan | `POST <Zeitplan>/api/rsvp-webhook`, `text/plain` | wie oben plus `attending` |
| `protocol-request` | Zeitplan → rsvp-app | `POST <rsvp-app>/api/timeline/protocol`, `text/plain` | `aud`, `timelineEventId`, `rsvpEventId`, `iat`, `exp` |
| `protocol` | Antwort darauf | Body der Antwort | `aud` (Zeitplan), beide IDs, `presence` (`[{ at, name, change: IN/OUT/BACK }]` oder `null`), `decisions` (oder `null`), `decisionsState` (`ok`/`off`/`unreachable`) |

## 🙌 Verknüpfung mit Schichten

Ein Termin kann optional mit einem Event im separaten Tool **Schichten** verknüpft werden, in dem sich Helfer\*innen
für Dienste eintragen (Bar, Einlass, Garderobe …). Wer genug Schichten hat, bekommt hier automatisch eine Zusage - mit
Bestätigungsmail und QR-Code für den Einlass. Rein additiv: Ohne Schichten-Link ändert sich nichts.

**Einrichten:**

1. In beiden `.env`-Dateien dasselbe, **eigene** Secret eintragen: hier `SHIFTS_SECRET`, in Schichten
   `RSVP_SHIFTS_SECRET`. Dazu hier `SHIFTS_BASE_URL` (Adresse von Schichten), dort `RSVP_APP_BASE_URL` (diese App).
2. **Beide Seiten stimmen zu:** In Schichten unter „Einstellungen“ → „Helfer-Zusagen in rsvp-app“ die ID des Termins
   eintragen (steht hier beim Termin unter „Verknüpfungen“) und hier den dort angezeigten Schichten-Link
   `https://…/rsvp/<schichten-event-id>`. Erst mit beiden Einträgen gilt die Verknüpfung.
3. **Stufen** im selben Abschnitt: eine Zeile pro Stufe, „1: Helfer\*innen“, „5: Helfer\*innen plus“ (Kategorien des
   Termins); ohne Kategorien nur die Zahl („1“). Die höchste erreichte Stufe gilt. Leer = keine Helfer-Zusagen.
   Nicht zusammen mit „Nur mit Einladung“ (Formular und Server sperren das).

**Ablauf:** Schichten schickt nach jeder Änderung (gebündelt) den **vollständigen Stand** aller bestätigten Helfer\*innen
an `POST /api/shifts/helpers` (`shift-helpers`: `helperId`, Name, E-Mail, Zahl der Schichten, `seq` zum Ordnen;
ältere Meldungen werden verworfen). `app/lib/shift-helpers-store.ts` wendet ihn an:

* Stufe erreicht: **feste Zusage** in der Kategorie der Stufe (`Rsvp.shiftHelperId`, `shiftCount`) - Kapazität und
  Kontingente gelten nicht (wie „Zulassen“ von Hand), der **Preis** der Kategorie schon (eine Stufe kann ein
  ermäßigtes Ticket sein). Neue Zusagen bekommen die normale Bestätigungsmail; Seating erfährt davon wie sonst.
* Stufe gewechselt: Kategorie und Betrag folgen - außer die Zusage ist bezahlt.
* Unter der ersten Stufe oder nicht mehr gemeldet: **Absage** (Nachrücken läuft), außer bezahlt oder eingelassen.
* Dieselbe E-Mail-Adresse hat schon eine **eigene Zusage**: bleibt unangetastet, die Helfer\*in geht als Konflikt an
  Schichten zurück (dort sichtbar), die Verwaltung entscheidet.
* Gäste sagen eine Helfer-Zusage nicht selbst ab und wechseln die Kategorie nicht (Formular und Server), Menü und
  übrige Angaben pflegen sie wie gewohnt. Die Gästeliste zeigt „Helfer\*in · N Schichten“, das CSV eine Spalte
  „Schichten“. Wird die Verknüpfung entfernt oder geändert, werden Helfer-Zusagen zu gewöhnlichen Zusagen.

**Vertrag** (`app/lib/shift-helpers.ts`, Gegenstück in Schichten `app/lib/rsvp/token.ts`): Format wie bei allen
verknüpften Tools, `SHIFTS_SECRET`, höchstens 1 Stunde gültig. Antwort: `{ ok, outcome: "applied" | "stale", conflicts }`;
401 bei ungültiger Nachricht, 404 ohne Verknüpfung. rsvp-app schickt Schichten nichts von sich aus.

## 🔐 Konto-Sicherheit

**Begriffe (suite-weit gleich):** Ein **Verwaltungskonto** ist ein Konto mit der Rolle Admin, Creator oder Moderator
(Code: `User`, Login unter `/admin/login`, Oberfläche "Verwaltung"). Ein **Teilnehmendenkonto** ist das freiwillige Konto
für Gäste unter "Mein Konto" (Code: `GuestUser`, früher "Nutzer-Konto"). **Admin** ist nur der Name einer Rolle, nie eine
Kontoart ("Konto mit Admin-Rolle"). Code-Bezeichner und Pfade (`/admin`, `GuestUser`) bleiben unverändert.

**Beide Konten verknüpfen:** Wer beides hat, verknüpft unter "Konto-Einstellungen" der Verwaltung sein
Teilnehmendenkonto (dessen E-Mail und Passwort als Nachweis). Danach meldet jeder Verwaltungs-Login, auch über ein
anderes Tool der Suite, zusätzlich unter "Mein Konto" an, und das Abmelden aus der Verwaltung beendet beide Sitzungen.
Die Konten selbst bleiben getrennt (eigene Passwörter, Sitzungen, Löschfristen). Die Verknüpfung wirkt **nur in diese
Richtung**: Das Passwort eines Teilnehmendenkontos lässt sich per Mail zurücksetzen, für Konten mit Admin-Rolle geht das
bewusst nicht. Ein Gast-Login darf deshalb nie eine Verwaltungssitzung öffnen. Ein Teilnehmendenkonto gehört höchstens zu
einem Verwaltungskonto, muss bestätigt sein und kann die Verknüpfung unter "Mein Konto → Konto-Einstellungen" selbst lösen.
Das Verknüpfen zählt gegen die Drosselung des Gast-Logins.

Gilt für Verwaltungskonten (`/admin/login`) **und** Teilnehmendenkonten (`/mein-konto`):

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
* **Bestätigungs-Links in Mails lösen nichts beim bloßen Aufruf aus** (Double-Opt-In einer Zusage `/verify`,
  Konto-Bestätigung `/mein-konto/verify`, E-Mail-Änderung `/admin/confirm-email` und `/mein-konto/confirm-email`):
  Link-Scanner von Mail-Anbietern (z.B. Microsoft Defender „Safe Links“) rufen Links automatisch ab. Die Seite prüft
  den Link deshalb nur und zeigt einen Button; erst der Klick bestätigt, und der Link ist danach verbraucht. Sonst
  könnte ein Scanner ein Konto bestätigen, das jemand mit fremder Adresse angelegt oder auf eine fremde Adresse
  umgestellt hat. „Passwort vergessen“ funktionierte schon so.
* **Sessions und Einmal-Links** (Reset, E-Mail-Änderung, Konto-Bestätigung) stehen in der Datenbank nur als SHA-256-Hash
  (`app/lib/tokens.ts`), der Klartext nur im Cookie bzw. Mail-Link. Beim ersten Start nach dem Update stellt
  `migrate-token-hashes.js` bestehende Tokens einmalig um (bereits verschickte Links funktionieren weiter) und beendet
  alle Sitzungen - alle müssen sich einmal neu anmelden.
* **Cookies** heißen `__Host-session` bzw. `__Host-guest-session` (HttpOnly, Secure, SameSite=Lax, ohne Domain-Attribut):
  Die Tools der Suite laufen auf Subdomains derselben Domain, so kann kein Tool einem anderen ein Cookie unterschieben.
* **Header** (`next.config.ts`, Bausteine aus `suite-kit/web`, Muster der Suite aus `suite-kit/docs/KONVENTIONEN.md`): `nosniff`, `Referrer-Policy`,
  HSTS. Einbetten ist grundsätzlich verboten (Clickjacking), **erlaubt nur für Gästeseiten** (`frame-ancestors *`, sie
  laufen als iFrame in einem CMS): Event-Seiten, Reihen und ihre Termine sowie die Registrierung, auf die sie im selben
  Frame verlinken. Verwaltung und Konto (`/admin`, `/mein-konto`) zusätzlich `noindex` und `no-store`, Seiten mit
  Token aus einer Mail (`/verify`, Reset, E-Mail-Bestätigung) `no-referrer`. Der Service Worker kommt nie aus einem Cache.
* **CSV-Exporte** (Gästeliste, Küche, Anwesenheit) über `csvResponse` aus `suite-kit/web`, dasselbe Format wie in allen
  Tools (Semikolon, CRLF, BOM, Anführungszeichen nur wo nötig): Textzellen, die Excel als Formel lesen würde
  (`= + - @`, Tab oder Zeilenumbruch am Anfang), bekommen ein Hochkomma vorangestellt - Gäste tragen ihre Namen selbst
  ein (CSV-Injection).
* **Mails** kommen aus der gemeinsamen Vorlage der Suite (`renderMail` aus `suite-kit/web`, Inhalt in
  `app/lib/mail-templates.ts`): Bausteine statt eigenem HTML, jeder Text escapet, nur sichere Links. Sonst ließe sich über eine Anmeldung mit fremder Adresse beliebiges HTML über unseren
  Absender an Dritte schicken.
* **Event-/Reihen-PIN** wird überall durchgesetzt, wo ein Event über seine ID erreichbar ist (`app/lib/pin.ts`) - Antworten, Kalenderdatei (`/api/ical`), Abstimmungs-Link und Konto-Registrierung für die Reihe, nicht nur die Anzeige der Seite. Der persönliche Link aus der Bestätigungs-Mail funktioniert weiter (gültiger Token dieses Termins). Das Raten der PIN ist gedrosselt (10 Versuche pro IP und Event, 100 pro Event, jeweils 15 Minuten).
* **Push-Abos** (Gäste über den persönlichen Link, Verwaltungskonten) werden nur gespeichert, wenn der Endpoint zu einem
  Push-Dienst der Browser-Hersteller gehört (`validPushSubscription` aus `suite-kit/web`). Der Server schickt später
  Anfragen an den Endpoint - vorher hätte jede*r mit einem persönlichen Link eine beliebige Adresse eintragen können,
  auch im internen Netz (SSRF).
* **Cron-Endpunkte** (`/api/cron/*`) lehnen ein leeres oder fehlendes `CRON_SECRET` ab - vorher schaltete `?secret=`
  (leer) den Endpunkt bei einem leeren Platzhalter-Secret frei.

## 🔗 Konten-Verbund mit anderen Tools (optional)

Über das gemeinsame Paket [`suite-kit`](https://github.com/druXter/suite-kit) (Protokoll, Sicherheitsregeln und Format
dort im README) kann man sich mit Verwaltungskonten (nicht Teilnehmendenkonten) auch mit dem Konto eines anderen Tools der Suite
anmelden - z.B. dem Abstimmungstool - und umgekehrt. Es gibt **keinen zentralen Anbieter**: Jedes Tool ist zugleich
Anbieter und Empfänger, und jedes bleibt mit eigenen Konten vollständig allein nutzbar.

* **Konfiguration:** `SUITE_SIGNING_KEY` + `SUITE_TRUSTED_APPS` (Anbieter), `SUITE_IDPS` (Empfänger), siehe `.env.example`.
  Ohne sie keine Föderation, kein Button.
* **Bevorzugter Anbieter** (`SUITE_LOGIN_REDIRECT`, optional): ein Origin aus `SUITE_IDPS`. Die Login-Seite leitet
  ohne Sitzung direkt dorthin weiter, statt erst das Formular zu zeigen. Nach einem Fehlschlag, beim Zurücksetzen des
  Passworts, nach dem Abmelden und wenn dieses Tool selbst als Anbieter gefragt ist, erscheint wie gewohnt das Formular; der lokale Login
  bleibt über `/admin/login?local=1` erreichbar.
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

### Teilnehmendenkonten im Verbund (rsvp-app als Anbieter)

Seit suite-kit v0.2.0 kann rsvp-app auch **Teilnehmendenkonten** (`GuestUser`, "Mein Konto") anderen Tools bestätigen -
heute dem Abstimmungstool (Modus "Nur mit Konto"). Getrennt vom Verbund der Verwaltungskonten:

* **Konfiguration:** `SUITE_SIGNING_KEY` und das andere Tool in `SUITE_PARTICIPANT_APPS` (nicht `SUITE_TRUSTED_APPS`);
  das andere Tool trägt rsvp-app mit `"participants": true` in seine `SUITE_IDPS` ein. Leer = keine Übermittlung.
* **Ablauf** (`/api/suite/authorize?…&kind=participant`): nicht angemeldet → Gast-Login unter `/mein-konto/login`;
  nur **bestätigte** Konten; beim ersten Mal pro Tool (und nach einem Entzug) die **Zustimmungsseite**
  `/mein-konto/freigabe`, die zeigt, was übertragen wird. Erst dann geht es zurück zum anderen Tool. Weiter über
  `/mein-konto/weiter` (echter Seitenwechsel, siehe Stolpersteine im suite-kit-README).
* **Übertragen** werden nur der **Name** und eine **paarweise Kennung** (`GuestToolConsent.subject`: zufällig, pro Tool
  eine andere - Tools können Personen nicht untereinander verknüpfen). Keine E-Mail, keine Profildaten, keine Antworten.
  Eine Verwaltungs-Sitzung zählt dabei nicht, es braucht immer die Gast-Sitzung.
* **Entziehen** unter "⚙️ Konto-Einstellungen" → "Anmeldung in anderen Tools". Die Zeile bleibt mit `revokedAt` stehen,
  damit die Person bei einer erneuten Freigabe dort wieder dieselbe ist (sonst könnte sie z.B. doppelt abstimmen). Eine
  laufende Anmeldung im anderen Tool endet spätestens nach 24 Stunden.
* Freigaben verschwinden mit dem Konto (Löschen, Löschfrist). Getestet in `tests/e2e/suite-participant.spec.ts` (die
  Empfänger spielen dort kleine Test-Server); einmal gemeinsam mit dem echten Abstimmungstool durchgespielt.

## 🧪 Tests

```bash
npm test            # Unit-Tests (vitest): Mail-Vorlagen, Passwort, Tokens, Drossel-IP und -Regeln, Rechte, PIN, Abstimmungs-Kopplung, Seating- und Zeitplan-Vertrag, verknüpfte Tools, Migrationen, Cron-Secret, Ticketkategorien und Platzregel, IBAN, GiroCode, Zahlstatus, Kontoauszug-Abgleich
npm run test:e2e    # Playwright gegen eine frisch gebaute Instanz auf http://127.0.0.1:3105
```

**Mails ansehen:** `npx tsx scripts/mail-preview.ts` schreibt alle Mails mit Beispieldaten als HTML und Text nach
`.e2e/mail-preview/` (ohne Datenbank). Mit `npx tsx --env-file=.env scripts/mail-preview.ts --send <adresse>` geht
zusätzlich die Bestätigung einer Zusage mit allem, was vorkommen kann (Begleitung, Menü, Zahlung mit GiroCode,
Einlass-QR-Code, Kalenderdatei), über den echten Absender an diese Adresse.

Die E2E-Tests löschen und erzeugen bei jedem Lauf ihre eigene Datenbank `prisma/test.db` (nie die Entwicklungs- oder
Produktivdatenbank), bauen mit `next build` und starten `next start` – sie prüfen also das, was auch in Produktion läuft.
Alles, was nach außen wirken würde (Mailversand, Push, Meldungen ans Abstimmungstool, Konten-Verbund), ist dabei per
Umgebungsvariable abgeschaltet – auch wenn die lokale `.env` echte Werte enthält. Fehlermeldungen zum Mailversand im
Testprotokoll (`ECONNREFUSED …:587`) sind deshalb erwartet.

Geprüft werden u. a.: Sicherheits-Header je Pfadgruppe (Event-Slugs inkl. `/sw.js` einbettbar, `/admin`, `/mein-konto` und
`/api/suite/*` nicht), Session-Cookie und Hash in der Datenbank für beide Logins, Session-Fixation, Open Redirect, gleiche
Meldung und Antwortzeit bei unbekannten Adressen, Sperre beim 11. Versuch pro E-Mail und 21. pro IP, erfundene
`X-Forwarded-For`-Einträge, 30 gleichzeitige Versuche, PIN-Drosselung, Reset- und Bestätigungs-Links (einmalig, weder Abruf noch Browser-Aufruf ohne Klick ändert etwas),
Cron-Secrets, Rechte je Stufe (Owner/Admin, Moderator*in per Event- oder Reihen-Freigabe, fremdes Konto) für Export,
Check-in, Löschen und Weitergeben, Konto-Zwang per fremdem `editToken`, PIN-Durchsetzung außerhalb der Seite, das
Ersetzen einer Antwort samt Warteliste, die signierte Kopplung mit dem Abstimmungstool (manipulierte Signatur,
abgelaufene Meldung, Klick-Token; Terminabstimmung: fremder Origin, andere Nachrichtenarten, neues Event nur für den
über den Verbund verknüpften Owner, einmaliges Übernehmen) sowie mit Seating und Zeitplan (Link nur für die eigene gültige Zusage, Signatur mit
dem eigenen Secret, Webhook nur an das verknüpfte Tool, keine Namen an den Zeitplan) und die verknüpften Tools allgemein (Übernahme alter Sitzplatz-Links,
Webhook nur an gültig verknüpfte Tools, fremde Adressen im Termin-Formular), Tickets und Bezahlung (Kategorie eines anderen Termins, Wechsel in eine volle Kategorie
oder nach der Zahlung, Bezahlstatus ohne Freigabe, Stornieren nur bei überfälliger Zahlung, Abendkasse, Sitzplatzwahl erst nach Zahlung, Kontoauszug-Import fremder Konten und Termine, Zahlungserinnerung nur einmal je Frist) – jeder Angriffsfall **mit Positivkontrolle**, dass derselbe Aufruf mit Berechtigung
wirkt.

Voraussetzung: Chromium für Playwright (`npx playwright install chromium`, einmalig). `next build` schreibt nach `.next/` –
nicht gleichzeitig mit `npm run dev` laufen lassen.

## 🔒 Sicherheitshinweise

**Bot-Schutz:** Neue Antworten ohne Konto und die Registrierung eines Teilnehmendenkontos gehen nur mit gelöster
Rechenaufgabe (`ProofOfWork` aus `suite-kit/ui` im Formular, Prüfung mit `powError` in `app/actions.ts` bzw.
`app/mein-konto/actions.ts`, Aufgaben unter `/api/suite/pow`). Der Browser rechnet im Hintergrund, meist bevor das
Formular ausgefüllt ist; jede Lösung gilt einmal und höchstens 10 Minuten. Kein Drittanbieter, keine Cookies, keine
neue Variable. Änderungen per Bearbeitungs-Link, Antworten mit Konto und die Client-API (`/api/v1`) brauchen sie nicht.
Ohne JavaScript lassen sich die geschützten Formulare nicht abschicken. Ergänzt die Drosselung, ersetzt sie nicht.

Die Datenbankdatei (`*.db`) und deine `.env`-Datei sind vom Tracking ausgeschlossen. Stelle sicher, dass du niemals echte Passwörter oder Nutzerdaten in das Git-Repository hochlädst.

## 🇪🇺 Datenschutz (DSGVO)

Die Datenschutzerklärung (`/datenschutz`) liest wie das Impressum ihre Angaben zur Laufzeit aus deiner `.env` (Verantwortlicher, E-Mail-Server) - trag deine echten Daten dort ein, im Repository bleiben nur Platzhalter. Gäste können ihre eigenen Daten jederzeit selbst vollständig löschen: über ihren persönlichen Bearbeitungslink ("Meine Daten vollständig löschen") bzw. über ihr Teilnehmendenkonto unter "Mein Konto" ("Konto & alle Daten unwiderruflich löschen"). Das Formular weist außerdem sichtbar auf eine aktive öffentliche Gästeliste hin, bevor eine Zusage abgeschickt wird, und erklärt bei Allergien/Essenswünschen kurz die Einwilligungsgrundlage.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.