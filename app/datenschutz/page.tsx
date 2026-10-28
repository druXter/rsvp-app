// app/datenschutz/page.tsx
import Link from 'next/link'
import { allowedSeatingOrigin } from '../lib/seating'
import { allowedTimelineOrigin } from '../lib/timeline'
import { allowedShiftsOrigin } from '../lib/shift-helpers'
import { allowedWichtelnOrigin } from '../lib/wichteln'

// Liest Verantwortlichen- und Infrastruktur-Angaben zur Laufzeit aus der (nicht
// versionierten) .env, analog zu app/impressum/page.tsx - siehe dort für die
// ausführliche Begründung von force-dynamic (verhindert, dass Next die Platzhalter
// beim Docker-Build dauerhaft in die statische HTML einbrennt).
export const dynamic = 'force-dynamic'

export default function DatenschutzPage() {
  const name = process.env.IMPRESSUM_NAME || '[Dein Vorname] [Dein Nachname]'
  const street = process.env.IMPRESSUM_STREET || '[Deine Straße und Hausnummer]'
  const zip = process.env.IMPRESSUM_ZIP || '[PLZ]'
  const city = process.env.IMPRESSUM_CITY || '[Ort]'
  const email = process.env.IMPRESSUM_EMAIL || '[Deine E-Mail-Adresse]'
  const phone = process.env.IMPRESSUM_PHONE || '[Deine Telefonnummer - Optional]'
  const smtpHost = process.env.SMTP_HOST || '[E-Mail-Server noch nicht konfiguriert]'
  // Die einzige Adresse, an die Angaben für die Sitzplatzwahl gehen dürfen (siehe app/lib/seating.ts)
  const seatingHost = allowedSeatingOrigin() ?? '[Sitzplatz-Anwendung nicht eingerichtet]'
  // Ebenso die einzige Adresse des Zeitplan-Tools (siehe app/lib/timeline.ts)
  const timelineHost = allowedTimelineOrigin() ?? '[Zeitplan-Anwendung nicht eingerichtet]'
  // Und die von Schichten (app/lib/shift-helpers.ts)
  const shiftsHost = allowedShiftsOrigin() ?? '[Schichten-Anwendung nicht eingerichtet]'
  // Und die von Wichteln (app/lib/wichteln.ts)
  const wichtelnHost = allowedWichtelnOrigin() ?? '[Wichteln-Anwendung nicht eingerichtet]'

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-gray-800 dark:text-gray-300 space-y-6">
        <h1 className="text-3xl font-bold border-b dark:border-gray-700 pb-4">Datenschutzerklärung</h1>

        <div>
          <h2 className="font-bold text-lg">1. Verantwortlicher</h2>
          <p className="mt-2">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) für die Datenverarbeitung auf dieser
            Website ist:
          </p>
          <p className="mt-2">
            {name}<br />
            {street}<br />
            {zip} {city}<br />
            E-Mail: {email}<br />
            Telefon: {phone}
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Weitere Angaben findest du im <Link href="/impressum" className="underline">Impressum</Link>.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">2. Übersicht: Welche Daten wir verarbeiten und warum</h2>
          <p className="mt-2">
            Diese Anwendung dient der Organisation von Veranstaltungen (Zu-/Absagen, Gästelisten, Warteliste,
            Einlasskontrolle). Wir erheben dabei ausschließlich Daten, die für diesen Zweck erforderlich sind oder die
            du uns freiwillig zusätzlich mitteilst. Rechtsgrundlage ist grundsätzlich Art. 6 Abs. 1 lit. b DSGVO
            (Erfüllung eines Vertrags bzw. vorvertraglicher Maßnahmen - deine Anmeldung zur Veranstaltung), für rein
            freiwillige Zusatzangaben (z.B. Allergien, siehe Punkt 4) sowie für optionale Funktionen wie
            Push-Benachrichtigungen (Punkt 6) oder die Anmeldung mit deinem Teilnehmendenkonto in einem anderen Tool
            (Punkt 3) Art. 6 Abs. 1 lit. a bzw. Art. 9 Abs. 2 lit. a DSGVO (Einwilligung durch das Ausfüllen des
            jeweiligen Feldes bzw. das aktive Aktivieren oder Erlauben der Funktion).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Registrierung & Login (Verwaltungs- und Teilnehmendenkonten)</h2>
          <p className="mt-2">
            Für Veranstalter:innen (Verwaltungskonto: E-Mail, Passwort-Hash) und für Gäste, die sich freiwillig ein Teilnehmendenkonto unter
            &quot;Mein Konto&quot; anlegen (E-Mail, Passwort-Hash, Name, optional Handynummer/Essenswunsch/Allergien),
            speichern wir Login-Daten. Passwörter werden ausschließlich als Hash (bcrypt) gespeichert, niemals im
            Klartext. Die Anmeldung erfolgt über ein zufällig erzeugtes Sitzungs-Token in einem Cookie (siehe Punkt 15)
            - niemals über deinen Namen oder deine E-Mail-Adresse direkt im Cookie. Bei einem Teilnehmendenkonto speichern
            wir außerdem den Zeitpunkt deines letzten Logins, um das Konto nach längerer Inaktivität automatisch
            löschen zu können (siehe Punkt 16).
          </p>
          <p className="mt-2">
            <strong>Antworten mit deinem Teilnehmendenkonto:</strong> Bist du angemeldet, verknüpfen wir deine Antwort
            auf einen Termin mit deinem Konto (Formular vorausgefüllt, Termin unter &quot;Mein Konto&quot;), Änderungen an
            Name, Telefon, Essenswunsch und Allergien übernehmen wir ins Konto. Gibt es zu dem Termin schon eine Antwort
            ohne Konto mit genau der E-Mail-Adresse deines (bestätigten) Kontos, ordnen wir sie beim nächsten Antworten
            deinem Konto zu, statt eine zweite anzulegen. Ohne Anmeldung oder über deinen persönlichen Link bleibt die
            Antwort wie bisher ohne Konto.
          </p>
          <p className="mt-2">
            <strong>Einladung deines Teilnehmendenkontos zu weiteren Terminen:</strong> Hast du mit deinem Konto bei einer
            Veranstaltung geantwortet oder bist Mitglied einer Reihe, können dich deren Veranstalter:innen (bzw. die dort
            Moderierenden) zu weiteren eigenen Terminen einladen. Sie sehen dafür deinen Namen und deine E-Mail-Adresse -
            wie in der Gästeliste der Veranstaltung, bei der du schon dabei bist; andere Veranstalter:innen sehen dein
            Konto nicht. Wir speichern die Einladung (Termin, Konto, wer eingeladen hat, Zeitpunkt), zeigen den Termin unter
            &quot;Mein Konto&quot; und schicken dir auf Wunsch der Einladenden eine Mail. Die Veranstalter:innen des neuen
            Termins sehen, dass du eingeladen bist. Unter &quot;Mein Konto&quot; kannst du den Termin ausblenden; mit dem
            Konto wird auch die Einladung gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Organisation von
            Veranstaltungen im Kreis, an dem du teilnimmst).
          </p>
          <p className="mt-2">
            <strong>Verwaltungs- und Teilnehmendenkonto verknüpfen (optional):</strong> Hast du beide Konten, kannst du
            sie in den Konto-Einstellungen der Verwaltung verknüpfen. Wir speichern dann am Verwaltungskonto, welches
            Teilnehmendenkonto dazugehört. Eine Anmeldung in der Verwaltung meldet dich danach auch unter &quot;Mein
            Konto&quot; an (umgekehrt nicht) und zählt dort als Login (siehe Punkt 16). Rechtsgrundlage ist Art. 6
            Abs. 1 lit. b DSGVO. Die Verknüpfung lässt sich auf beiden Seiten jederzeit lösen und verschwindet
            automatisch, wenn eines der beiden Konten gelöscht wird.
          </p>
          <p className="mt-2">
            <strong>Sicherer Umgang mit Zugangsdaten:</strong> Passwörter werden mit bcrypt gehasht. Auch
            Sitzungs-Tokens sowie die Einmal-Links für Passwort-Reset, E-Mail-Änderung und die Bestätigung eines
            Teilnehmendenkontos speichern wir in der Datenbank <strong>nur als Hash</strong> - der Klartext steht allein
            in deinem Cookie bzw. in der Mail an dich. Eine Kopie der Datenbank ermöglicht damit weder die
            Übernahme einer Sitzung noch das Einlösen eines Links.
          </p>
          <p className="mt-2">
            <strong>Schutz vor Missbrauch (Anmelde-Drosselung):</strong> Um das Erraten von Passwörtern und das
            massenhafte Auslösen von Mails (Passwort-Reset, Registrierung) sowie das Durchprobieren von
            Event-PINs zu verhindern, zählen wir Anmelde-, Mail- und PIN-Anfragen. Dazu wird deine <strong>IP-Adresse</strong> ausgelesen und zusammen mit der eingegebenen
            E-Mail-Adresse <strong>nur als nicht umkehrbarer Hash</strong> für ein kurzes Zeitfenster (15 Minuten
            bzw. 1 Stunde) gespeichert; veraltete Zähler werden nach spätestens 24 Stunden entfernt. Rechtsgrundlage
            ist unser berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
          <p className="mt-2">
            <strong>Rechenaufgabe vor dem Absenden (Bot-Schutz):</strong> Bevor eine Antwort ohne Konto oder eine Registrierung abgeschickt wird, löst dein
            Browser im Hintergrund eine kleine Rechenaufgabe, die unser Server stellt und prüft. Das hält automatisierte
            Massen-Anfragen ab. Dabei werden keine Cookies gesetzt, keine Dienste Dritter eingebunden und keine Daten über
            dich gespeichert; der Server merkt sich nur für höchstens 10 Minuten, welche Aufgabe schon gelöst wurde. Ohne
            JavaScript lassen sich diese Formulare deshalb nicht abschicken.
          </p>
          <p className="mt-2">
            <strong>Anmeldung mit dem Konto eines anderen Tools (optional, nur Verwaltungskonten):</strong> Ist dies vom
            Betreiber eingerichtet, kannst du dich hier mit einem Konto eines verbundenen Tools anmelden (z.B. dem
            Abstimmungstool), und umgekehrt kann man sich dort mit einem Konto von hier anmelden. Das geschieht{' '}
            <strong>nur, wenn du es aktiv anstößt</strong>, und nur zwischen Tools, die der Betreiber ausdrücklich
            freigegeben hat. Dabei übermittelt das Tool, bei dem du angemeldet bist, an das andere eine etwa eine
            Minute gültige, digital signierte Bestätigung mit <strong>deiner Konto-Kennung, E-Mail-Adresse und
            Rolle</strong> - niemals dein Passwort oder deine Sitzung. Die Verknüpfung speichern wir und du kannst
            sie unter &quot;⚙️ Konto-Einstellungen&quot; jederzeit entfernen. Für Teilnehmendenkonten
            (&quot;Mein Konto&quot;) gilt der folgende, eigene Ablauf.
          </p>
          <p className="mt-2">
            <strong>Verknüpftes Event im Zeitplan, in Schichten oder in Wichteln anlegen (optional, nur Verwaltungskonten):</strong>{' '}
            Klickst du bei einem Termin auf &quot;Im Zeitplan anlegen&quot;, &quot;In Schichten anlegen&quot; bzw. &quot;In Wichteln anlegen&quot;, fragen
            wir beim Öffnen der Einstellungen und beim Klick das jeweilige Tool mit einer signierten, eine Minute gültigen
            Nachricht. Sie enthält <strong>die Kennung des Termins und deines Kontos</strong> (bzw. die Kennung deines
            Kontos dort, wenn du dich hier über das Tool anmeldest), beim Anlegen zusätzlich <strong>Titel und Datum des
            Termins</strong>. Das Event gehört dort dem Konto, das mit deinem verknüpft ist; ohne Verknüpfung legt das
            Tool nichts an.
          </p>
          <p className="mt-2">
            <strong>Mit deinem Teilnehmendenkonto in einem anderen Tool anmelden (optional):</strong> Ist dies vom
            Betreiber eingerichtet, kannst du dich mit deinem Konto unter &quot;Mein Konto&quot; auch in einem
            verbundenen Tool anmelden, z.B. um im Abstimmungstool abzustimmen. Beim ersten Mal fragen wir dich auf einer
            eigenen Seite, ob du das willst, und zeigen, was übertragen wird. Erst nach deiner Zustimmung übermitteln wir
            dem Tool eine etwa eine Minute gültige, digital signierte Bestätigung mit <strong>deinem Namen und einer
            Kennung, die nur für dieses eine Tool gilt</strong> - nie deine E-Mail-Adresse, Telefonnummer,
            Essenswünsche oder Antworten, und keine Kennung, mit der verschiedene Tools dich miteinander verknüpfen
            könnten. Wir speichern, welchem Tool du zugestimmt hast, die Kennung und wann du die Anmeldung zuletzt
            genutzt hast. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO); du kannst sie unter
            &quot;⚙️ Konto-Einstellungen&quot; jederzeit entziehen. Eine dort bereits laufende Anmeldung endet dann
            spätestens nach 24 Stunden. Was das andere Tool speichert, steht in dessen Datenschutzerklärung.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Angaben im RSVP-Formular</h2>
          <p className="mt-2">
            Je nach Konfiguration der jeweiligen Veranstaltung fragen wir Name (Pflichtfeld), E-Mail-Adresse,
            Handynummer, Essenswunsch, Menüwahl, Begleitungen, Alkohol-Präferenz, Mitbringsel (als Freitext oder als Eintrag aus
            einer Mitbringliste, z.B. „Salat“) und freie Zusatzfragen ab. Diese
            Angaben verwenden wir ausschließlich zur Organisation und Durchführung der jeweiligen Veranstaltung. Wir
            geben deine Daten nicht an Dritte außerhalb der in Punkt 16 genannten Auftragsverarbeiter weiter.
          </p>
          <p className="mt-2">
            <strong>Allergien/Unverträglichkeiten:</strong> Dieses Feld ist stets freiwillig und optional. Da
            Gesundheitsangaben eine besondere Kategorie personenbezogener Daten nach Art. 9 DSGVO darstellen können,
            verarbeiten wir sie ausschließlich auf Basis deiner ausdrücklichen Einwilligung, die du durch das
            freiwillige Ausfüllen dieses Feldes erteilst (Art. 9 Abs. 2 lit. a DSGVO). Du kannst diese Einwilligung
            jederzeit mit Wirkung für die Zukunft widerrufen, z.B. indem du deine Angabe über deinen persönlichen Link
            entfernst oder deine Daten vollständig löschst (siehe Punkt 18).
          </p>
          <p className="mt-2">
            <strong>Begleitungen:</strong> Lässt eine Veranstaltung Begleitungen zu, gibst du für jede Person, die du
            mitbringst, ihren Namen und ihre Altersgruppe (erwachsen, Kind, Kleinkind) an und, je nach Veranstaltung,
            ihren Essenswunsch, ihre Allergien, ihre Menüwahl und (bei Erwachsenen) ob sie Alkohol trinkt. Das gilt auch für Kinder. Bitte gib diese Angaben nur an, wenn die
            Personen (bei Kindern die Sorgeberechtigten) damit einverstanden sind; für Allergien gilt das oben Gesagte
            entsprechend. Wir verwenden die Angaben wie deine eigenen nur zur Organisation der Veranstaltung (Plätze,
            Verpflegung, Einlass) und löschen sie zusammen mit deiner Antwort.
          </p>
          <p className="mt-2">
            <strong>Einladungen:</strong> Bei Veranstaltungen „nur mit Einladung“ (z.B. einer Hochzeit) tragen die
            Veranstalter:innen vorab ein, wen sie einladen: eine Bezeichnung des Haushalts (z.B. „Familie Müller“), die
            Namen und Altersgruppen der eingeladenen Personen, optional eine E-Mail-Adresse und eine interne Notiz.
            Diese Daten stammen also nicht von dir, sondern von den Veranstalter:innen (Art. 14 DSGVO); wir verwenden
            sie nur, um dir die Einladung zuzustellen und deine Antwort zuzuordnen. Jeder Haushalt bekommt einen
            persönlichen Link, über den ihr für jede Person zu- oder absagt, Namen korrigiert und - falls vorgesehen -
            weitere Personen eintragt. Bei einer Reihe von Terminen (z.B. Polterabend, Trauung und Feier) gilt der Link
            für alle Termine, zu denen ihr eingeladen seid; geantwortet wird pro Termin. Ohne diesen Link zeigt die
            Veranstaltungsseite nur den Titel. Über den Link kannst du eure Daten auch selbst vollständig löschen; damit
            verschwindet auch die Einladung.
          </p>
          <p className="mt-2">
            <strong>Von den Veranstalter:innen eingetragene Antworten:</strong> Hast du den Veranstalter:innen auf
            anderem Weg (z.B. persönlich oder am Telefon) zu-, ab- oder „vielleicht“ gesagt, können sie deine Antwort
            selbst eintragen: deinen Namen und optional deine E-Mail-Adresse. Diese Daten stammen von den
            Veranstalter:innen (Art. 14 DSGVO), wir verwenden sie wie eine selbst abgegebene Antwort nur zur Organisation
            der Veranstaltung und löschen sie mit ihr. Eine Mail (z.B. die Bestätigung mit Kalenderdatei oder die Bitte,
            deine Adresse zu bestätigen) schicken wir dir nur, wenn die Veranstalter:innen das beim Eintragen wählen.
            Deine Adresse gilt nur dann als bestätigt, wenn die Veranstalter:innen das ausdrücklich angeben (z.B. weil du sie ihnen selbst
            genannt hast); sonst ist sie unbestätigt wie bei einer selbst abgegebenen Antwort, bis du sie über den
            Bestätigungslink bestätigst. Ändern die Veranstalter:innen deine Adresse, gilt sie danach wieder als
            unbestätigt, außer sie geben ausdrücklich an, dass sie bestätigt ist.
          </p>
          <p className="mt-2">
            <strong>Antwortfrist:</strong> Legen die Veranstalter:innen eine Antwortfrist fest, kannst du deine Antwort
            danach nicht mehr selbst ändern (wohl aber deine Daten löschen); Änderungen nehmen dann die
            Veranstalter:innen vor.
          </p>
          <p className="mt-2">
            <strong>Wunschliste:</strong> Hat eine Veranstaltung eine Wunschliste (z.B. für eine Hochzeit), kannst du
            über deinen persönlichen Link Geschenke reservieren oder einen Betrag für einen Geldwunsch eintragen. Wir
            speichern, was du reserviert hast (Stückzahl bzw. Betrag). Andere Gäste sehen nur, was noch frei ist, nie
            von wem. Die Veranstalter:innen sehen deinen Namen dazu nur, wenn sie die Einstellung „Überraschung“
            ausgeschaltet haben. Die Reservierung kannst du jederzeit aufheben; sie wird mit deinen Daten gelöscht.
            Bezahlt wird nicht über uns.
          </p>
          <p className="mt-2">
            <strong>Tickets und Bezahlung:</strong> Bietet eine Veranstaltung Ticketkategorien an (z.B.
            &quot;Studierende&quot;, &quot;Gäste&quot;), speichern wir an deiner Antwort die gewählte Kategorie, den zu
            zahlenden Betrag und einen Verwendungszweck, über den die Veranstalter:innen deine Überweisung zuordnen.
            Dazu kommen der Zahlungsstatus (offen, bezahlt, erstattet), die Zahlart (Überweisung oder bar), die
            jeweiligen Zeitpunkte und gegebenenfalls eine Zahlfrist. Die Zahlung selbst läuft nicht über uns: Du
            überweist direkt an das angezeigte Konto der Veranstalter:innen, und diese markieren den Eingang von Hand.
            Deine Bankdaten (IBAN, Kontoinhaber) erfahren wir dabei nicht und speichern sie nicht; der GiroCode auf
            deiner Seite und in der Bestätigungsmail enthält nur die Daten des Empfängerkontos, den Betrag und den
            Verwendungszweck und wird erst in deiner Banking-App ausgewertet. Nach Zahlungseingang bekommst du eine
            Bestätigung per E-Mail (bei einer Barzahlung am Einlass nicht). Ist die Zahlung offen, können wir dich vor
            Ablauf der Frist per E-Mail und, falls aktiviert, per Push daran erinnern. Gleichen Veranstalter:innen
            Zahlungen über einen Kontoauszug ab, wird die Datei nur für diesen Abgleich gelesen und nicht gespeichert;
            gespeichert wird allein, dass deine Zahlung eingegangen ist. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b
            DSGVO (Abwicklung deiner Anmeldung).
          </p>
          <p className="mt-2">
            <strong>Veranstaltungsreihen:</strong> Gehört ein Termin zu einer Reihe, werden deine Kontakt- und
            Profilangaben einmalig für die gesamte Reihe gespeichert und für weitere Termine derselben Reihe
            wiederverwendet, damit du sie nicht bei jedem Termin erneut eingeben musst. Deine eigentliche Antwort
            (Zu-/Absage, Begleitung, Mitbringsel usw.) wird dagegen immer getrennt pro Termin gespeichert.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. E-Mails an Gäste (Bestätigung, Erinnerung, Änderungen)</h2>
          <p className="mt-2">
            Ist für eine Veranstaltung die E-Mail-Bestätigung aktiviert, verschicken wir dir einen Bestätigungslink,
            bevor deine Anmeldung gültig wird - das schützt dich und uns vor missbräuchlichen Anmeldungen unter
            fremdem Namen. Sofern du eine E-Mail-Adresse hinterlegt hast, erhältst du außerdem eine Bestätigung deiner
            Zusage (mit Kalenderdatei und - falls aktiviert - deinem Einlass-QR-Code), Benachrichtigungen zur
            Warteliste sowie automatische oder manuelle Erinnerungen vor der Veranstaltung. Hat die Veranstaltung einen
            Feedback-Fragebogen, bekommst du nach ihrem Ende einmal die Bitte um Feedback (siehe Punkt 9).
          </p>
          <p className="mt-2">
            <strong>Einladungen:</strong> Haben die Veranstalter:innen für deinen Haushalt eine E-Mail-Adresse
            eingetragen, schicken wir dorthin die Einladung mit eurem persönlichen Link und - falls ihr bis kurz vor der
            Antwortfrist noch nicht geantwortet habt - einmal eine Erinnerung (bei einer Reihe pro Termin mit Frist).
          </p>
          <p className="mt-2">
            <strong>Antwort „Vielleicht“:</strong> Erlaubt eine Veranstaltung „vielleicht“ als Antwort und wählst du es
            (bzw. für eine Person deines Haushalts), brauchen wir eine E-Mail-Adresse, die du über einen Link bestätigst,
            und den von dir gewählten Erinnerungszeitpunkt. Zu diesem Zeitpunkt schicken wir dir einmal eine Erinnerung,
            dich zu entscheiden; ohne bestätigte Adresse schicken wir nichts. Wer bis zum Stichtag (Antwortfrist,
            spätestens 12 Stunden vor Beginn) noch „vielleicht“ angegeben hat, wird als abgesagt eingetragen und bekommt
            darüber eine Mitteilung - ebenso, wenn die Veranstalter:innen „vielleicht“ für die Veranstaltung abschalten.
            Rechtsgrundlage ist die Durchführung der von dir gewünschten Anmeldung (Art. 6 Abs. 1 lit. b DSGVO).
            Verknüpfte Tools (z. B. Abstimmungen, Sitzplatzwahl, Zeitplan) behandeln „vielleicht“ wie eine Absage und
            erfahren davon nichts weiter.
          </p>
          <p className="mt-2">
            <strong>Änderungs-Mitteilungen:</strong> Ändert die Veranstalter:in nach deiner Zusage wesentliche Angaben
            zum Termin (Titel, Datum, Dauer, Ort oder Beschreibung), kann sie alle bereits zugesagten Gäste darüber
            informieren - und alle, die „vielleicht“ angegeben und ihre Adresse bestätigt haben. Du erhältst diese Mitteilung per E-Mail und - falls du Push-Benachrichtigungen aktiviert hast
            - zusätzlich als Push-Benachrichtigung (siehe Punkt 6).
          </p>
          <p className="mt-2">
            <strong>Bestätigungs-Mails abbestellen:</strong>{' '}Hast du ein Teilnehmendenkonto unter &quot;Mein Konto&quot; und
            dort Push-Benachrichtigungen aktiviert, kannst du unter &quot;⚙️ Konto-Einstellungen&quot; festlegen, dass
            wir dir keine Bestätigungs-Mails mehr schicken - du erhältst die Bestätigung dann ausschließlich als
            Push-Benachrichtigung. Diese Einstellung lässt sich jederzeit wieder zurücknehmen. Verifizierungs-,
            Passwort-Reset- und E-Mail-Änderungs-Nachrichten sind davon ausgenommen, da sie für die Sicherheit deines
            Kontos erforderlich sind.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Push-Benachrichtigungen (PWA)</h2>
          <p className="mt-2">
            Diese Anwendung kann als App auf deinem Gerät installiert werden (Progressive Web App) und dir auf Wunsch
            Push-Benachrichtigungen schicken. Diese Funktion ist <strong>immer freiwillig</strong> und wird erst aktiv,
            nachdem du sie selbst aktiviert und die Benachrichtigungs-Erlaubnis deines Browsers erteilt hast
            (Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO - Einwilligung).
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>
              <strong>Als Gast:</strong> Erinnerungen an bevorstehende Termine, Mitteilungen über Termin-Änderungen,
              bei „vielleicht“ die Erinnerung zum gewählten Zeitpunkt und die Mitteilung über die automatische Absage
              und - falls du Bestätigungs-Mails abbestellt hast (Punkt 5) - die Bestätigung deiner Zusage. Bei einer
              Veranstaltungsreihe gilt eine einmal aktivierte Benachrichtigung für alle Termine dieser Reihe.
            </li>
            <li>
              <strong>Als Veranstalter:in:</strong> Hinweise auf neue Zu- und Absagen zu den eigenen Veranstaltungen.
            </li>
          </ul>
          <p className="mt-2">
            Für die Zustellung speichern wir die technische Abo-Adresse (Endpoint-URL) und die Verschlüsselungs-Keys
            deines Browsers. Die Auslieferung erfolgt technisch über den Push-Dienst deines Browser-Herstellers - die
            damit verbundene Datenübermittlung ist in Punkt 16 beschrieben. Du kannst die Benachrichtigungen jederzeit
            an derselben Stelle wieder deaktivieren oder die Erlaubnis in den Einstellungen deines Browsers entziehen;
            das gespeicherte Abo wird dann gelöscht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. Öffentliche Gästeliste</h2>
          <p className="mt-2">
            Manche Veranstaltungen zeigen optional eine öffentliche Gästeliste, auf der andere Gäste sehen können, wer
            zugesagt oder „vielleicht“ angegeben hat, wer eine Begleitung mitbringt und wer welches Mitbringsel beisteuert (auch die übernommenen
            Einträge einer Mitbringliste). Ohne öffentliche Gästeliste sehen andere Gäste bei einer Mitbringliste nur,
            wie viele Plätze eines Eintrags vergeben sind, nicht an wen. Dort wird
            ausschließlich dein <strong>Name</strong> angezeigt - deine E-Mail-Adresse, Handynummer und Allergien
            werden dabei niemals veröffentlicht. Ist diese Funktion für eine Veranstaltung aktiv, weisen wir dich im
            RSVP-Formular selbst noch einmal ausdrücklich darauf hin, bevor du deine Zusage absendest.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">8. QR-Code-Einlasskontrolle</h2>
          <p className="mt-2">
            Ist für eine Veranstaltung die Einlasskontrolle aktiviert, erhältst du bei einer bestätigten Zusage einen
            persönlichen QR-Code (per E-Mail und auf der Erfolgsseite). Wird dieser beim Einlass gescannt, speichern
            wir den Zeitpunkt des Check-ins - pro Person, also auch für deine Begleitungen bzw. die Personen deines
            Haushalts. Dies dient ausschließlich der Zutrittskontrolle vor Ort.
          </p>
          <p className="mt-2">
            Bei Sitzungen und Versammlungen können Veranstalter:innen zusätzlich „Kommen und Gehen protokollieren“
            einschalten. Dann speichern wir jedes Kommen, Gehen und Wiederkommen mit Uhrzeit und dem Namen der Person.
            Das dient der Feststellung, wer wann anwesend war (z.B. für die Beschlussfähigkeit und das
            Sitzungsprotokoll, Art. 6 Abs. 1 lit. f DSGVO bzw. die Pflichten aus der Satzung). Sehen können das nur die
            Veranstalter:innen und von ihnen freigegebene Konten. Das Protokoll wird zusammen mit deiner Antwort bzw.
            der Veranstaltung gelöscht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Verlinkte externe Abstimmungen</h2>
          <p className="mt-2">
            Veranstalter:innen können einen Termin mit einer Abstimmung in einer separaten Abstimmungs-Anwendung
            verknüpfen. Diese Anwendung ist ein eigenständiges Angebot mit einer eigenen Datenschutzerklärung; erst
            wenn du den entsprechenden Link aktiv anklickst, verlässt du diese Anwendung.
          </p>
          <p className="mt-2">
            Bist du zu diesem Zeitpunkt mit einem bestätigten Teilnehmendenkonto unter &quot;Mein Konto&quot; angemeldet,
            übermitteln wir dabei <strong>deine E-Mail-Adresse</strong> in einem kryptographisch signierten,{' '}
            <strong>nur 10 Minuten gültigen</strong> Token an die verlinkte Abstimmung. Das dient ausschließlich dazu,
            dich dort als bereits bestätigte Person auszuweisen, damit du nicht erneut eine Verifizierung durchlaufen
            musst. Weitere Angaben (Name, Handynummer, Essenswunsch, Allergien, deine Antworten) werden dabei nicht
            übertragen, ebenso wenig dein Passwort oder deine Sitzung. Bist du nicht angemeldet, führt derselbe Link
            ohne jede Übermittlung personenbezogener Daten zur Abstimmung.
          </p>
          <p className="mt-2">
            <strong>Terminabstimmung:</strong> Wird das Datum eines Termins per Abstimmung festgelegt, meldet die
            Abstimmungs-Anwendung uns nur den Termin (sowie ggf. Titel und die Konto-Kennung der Person, der die
            Abstimmung gehört, damit wir für sie ein Event anlegen können). Damit du nicht doppelt benachrichtigt wirst,
            schickt sie außerdem nicht umkehrbare Prüfwerte (SHA-256-Hashes) der E-Mail-Adressen, die sie selbst
            informiert; wir vergleichen sie nur mit den Adressen der Zusagenden dieses Termins und speichern sie nicht.
            Wer zugesagt hat, bekommt von uns wie bei jeder Terminänderung eine Mail bzw. Push-Mitteilung.
          </p>
          <p className="mt-2">
            <strong>Feedback-Fragebogen:</strong> Veranstalter:innen können einen Termin mit einem Fragebogen in der
            Abstimmungs-Anwendung verknüpfen. Gäste mit Zusage (bei Terminen mit QR-Einlass nur, wer eingecheckt wurde)
            sehen nach dem Ende auf ihrer persönlichen Seite &quot;Feedback geben&quot; und bekommen - wenn die
            Veranstalter:innen das eingestellt haben - einmal eine Mail bzw. Push-Mitteilung mit diesem Link. Beim Klick
            übermitteln wir in einem kryptographisch signierten, <strong>12 Stunden gültigen</strong> Link nur ein{' '}
            <strong>Pseudonym deiner Antwort</strong>: eine aus der Kennung deiner Antwort und des Fragebogens
            berechnete Zeichenfolge, aus der die Abstimmungs-Anwendung weder deinen Namen noch deine E-Mail-Adresse
            ableiten kann. Sie erkennt daran nur, dass du schon geantwortet hast, damit es eine Antwort pro Gast bleibt
            und du sie ändern kannst. Deine Antworten im Fragebogen speichert die Abstimmungs-Anwendung (siehe deren
            Datenschutzerklärung); wir bekommen sie nicht. Für den Versand merken wir uns bei deiner Antwort, wann wir
            dir den Fragebogen geschickt haben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse
            der Veranstalter:innen an Rückmeldungen zu ihrer Veranstaltung); die Teilnahme ist freiwillig.
          </p>
          <p className="mt-2">
            <strong>Sitzungen (Versammlungen):</strong> Veranstalter:innen können einen Termin mit einer Sitzung in der
            Abstimmungs-Anwendung verknüpfen (Abstimmungen, Rednerliste). Gäste mit Zusage sehen &quot;Zur Sitzung&quot;.
            Beim Klick übermitteln wir in einem kryptographisch signierten, <strong>15 Minuten gültigen</strong> Link{' '}
            <strong>deinen Namen</strong> (für die Rednerliste und namentliche Abstimmungen) und ein{' '}
            <strong>Pseudonym deiner Antwort</strong>, das nur für diese Sitzung gilt - keine E-Mail-Adresse und keine
            weiteren Angaben. Damit nur Anwesende abstimmen können, fragt die Abstimmungs-Anwendung bei uns ab, wer gerade
            eingecheckt ist; wir antworten nur mit den Pseudonymen der Anwesenden und der Zahl der Zusagen. Beim
            Speichern des Links melden wir der Abstimmungs-Anwendung außerdem Kennung und Titel des Termins. Für die
            Sitzungsleitung (und wen sie dort freigibt, etwa das Protokoll) übermitteln wir auf Anfrage eine
            Anwesenheitsliste mit den <strong>Namen und Pseudonymen aller Zusagen</strong> und ob die Person gerade da
            ist, damit sie ohne Scan ein- und auschecken kann; die Abstimmungs-Anwendung zeigt die Liste nur an und
            speichert sie nicht. Checkt die Sitzungsleitung jemanden ein oder aus - oder du dich selbst, wenn die
            Sitzung das erlaubt -, halten wir das wie beim Einlass-Scan fest (mit &quot;Kommen und Gehen&quot; samt
            Uhrzeit). Rechtsgrundlage ist die Durchführung der Versammlung (Art. 6 Abs. 1 lit. b bzw. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Sitzplatzwahl (Seating)</h2>
          <p className="mt-2">
            Veranstalter:innen können einen Termin mit einem Event in der separaten Sitzplatz-Anwendung
            &quot;Seating&quot; unter <code>{seatingHost}</code> verknüpfen, etwa für eine Tischbuchung oder eine
            Sitzordnung. Seating ist ein eigenständiges Angebot mit einer eigenen Datenschutzerklärung. Ist ein Termin
            nicht verknüpft, geht nichts an Seating.
          </p>
          <p className="mt-2">
            Für eine <strong>bestätigte Zusage</strong> (nicht auf der Warteliste, falls der Termin eine
            E-Mail-Bestätigung verlangt, bestätigt, und falls die Veranstalter:innen die Sitzplatzwahl erst nach der
            Zahlung freigeben, bezahlt) übermitteln wir an Seating: eine Kennung deiner Antwort, deinen{' '}
            <strong>Namen</strong>, deine <strong>E-Mail-Adresse</strong> (nur, falls du eine angegeben hast) und den{' '}
            die <strong>Namen deiner Begleitungen</strong> (ohne Kleinkinder, die keinen eigenen Platz brauchen) - und zwar
          </p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>wenn du auf &quot;Sitzplatz wählen&quot; klickst, in einem kryptographisch signierten, nur 15 Minuten gültigen Link;</li>
            <li>wenn sich deine Antwort ändert (Zusage, Absage, Warteliste, Nachrücken, Änderung von Name oder Begleitungen, Löschung), als direkte Meldung von Server zu Server, damit eine dort gebuchte Platzwahl angepasst oder storniert wird - bei einer Absage oder Löschung nur mit dem Hinweis, dass die Zusage nicht mehr gilt;</li>
            <li>wenn Seating für die Sitzordnung die aktuelle Liste der Zusagen dieses Termins abruft.</li>
          </ul>
          <p className="mt-2">
            Handynummer, Essenswunsch, Allergien, deine weiteren Antworten, dein Passwort und deine Sitzung werden dabei
            nie übertragen. Seating meldet uns umgekehrt den dir zugewiesenen Platz (z.B. &quot;Tisch 7, Plätze 3,
            4&quot;) und, soweit bekannt, Tisch und Platz jeder Person deiner Antwort. Wir speichern das an deiner
            Antwort, zeigen den Platz dir auf deiner Termin-Seite, den Veranstalter:innen beim Einlass, in der
            Küchenliste pro Tisch und im Export, und löschen ihn zusammen mit deiner Antwort.
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Organisation der Veranstaltung, zu der auch die Sitzordnung
            gehört). Was Seating selbst mit den Angaben macht (z.B. eine Buchungsbestätigung an deine E-Mail-Adresse),
            steht in dessen Datenschutzerklärung.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. Zeitplan</h2>
          <p className="mt-2">
            Veranstalter:innen können einen Termin mit einem Event in der separaten Zeitplan-Anwendung unter{' '}
            <code>{timelineHost}</code> verknüpfen, die den Ablauf der Veranstaltung zeigt (z.B. wann was beginnt).
            Die Zeitplan-Anwendung ist ein eigenständiges Angebot mit einer eigenen Datenschutzerklärung. Ist ein Termin
            nicht verknüpft, geht nichts an sie.
          </p>
          <p className="mt-2">
            Für eine <strong>bestätigte Zusage</strong> (nicht auf der Warteliste und, falls der Termin eine
            E-Mail-Bestätigung verlangt, bestätigt) übermitteln wir an die Zeitplan-Anwendung ausschließlich{' '}
            <strong>Kennungen</strong> - die deiner Antwort, die des Termins und die des verknüpften Zeitplans - und{' '}
            <strong>ob deine Zusage gilt</strong>. Dein Name, deine E-Mail-Adresse, deine Begleitung und alle übrigen
            Angaben werden nie übertragen. Das geschieht
          </p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>wenn du auf &quot;Zeitplan&quot; klickst, in einem kryptographisch signierten, nur 10 Minuten gültigen Link - die Zeitplan-Anwendung richtet damit in deinem Browser einen Zugang für diese Veranstaltung ein (Einzelheiten in ihrer Datenschutzerklärung);</li>
            <li>wenn sich deine Antwort ändert (Zusage, Absage, Warteliste, Nachrücken, Löschung), als direkte Meldung von Server zu Server - bei einer Absage, auf der Warteliste oder nach einer Löschung beendet die Zeitplan-Anwendung damit deinen Zugang.</li>
          </ul>
          <p className="mt-2">
            Die Zeitplan-Anwendung meldet uns nichts zurück. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO
            (Organisation der Veranstaltung, zu der auch ihr Ablauf gehört).
          </p>
          <p className="mt-2">
            <strong>Protokoll von Sitzungen:</strong> Nur wenn die Veranstalter:innen es beim Termin ausdrücklich und
            einzeln freigeben, darf die Zeitplan-Anwendung beim Öffnen ihres Rückblicks zusätzlich abrufen, wann du
            gekommen und gegangen bist - mit deinem Namen bzw. dem deiner Begleitung (siehe Punkt 8, &quot;Kommen und
            Gehen&quot;) - und die Ergebnisse der Abstimmungen der verknüpften Sitzung (Punkt 9), bei namentlichen
            Abstimmungen mit Namen. Diese holen wir dafür bei der Abstimmungs-Anwendung ab. Die Zeitplan-Anwendung zeigt die
            Angaben angemeldeten Konten mit Zugriff auf die Veranstaltung beim jeweiligen Tagesordnungspunkt an und
            speichert sie nicht. Rechtsgrundlage ist wie beim Anwesenheitsprotokoll das berechtigte Interesse an einem
            vollständigen Sitzungsprotokoll (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11a. Schichten (Helfer*innen)</h2>
          <p className="mt-2">
            Veranstalter:innen können einen Termin mit einem Event in der separaten Anwendung „Schichten“ unter{' '}
            <code>{shiftsHost}</code> verknüpfen, in der sich Helfer*innen für Dienste (z. B. Bar oder Einlass) eintragen.
            Schichten ist ein eigenständiges Angebot mit einer eigenen Datenschutzerklärung. Ist ein Termin nicht verknüpft,
            passiert nichts.
          </p>
          <p className="mt-2">
            Bei einem verknüpften Termin meldet Schichten uns für jede Helfer*in, die ihre E-Mail-Adresse dort bestätigt
            hat, <strong>Namen, E-Mail-Adresse und die Zahl ihrer Schichten</strong>. Wer genug Schichten hat, bekommt hier
            eine Zusage (mit Bestätigungsmail und ggf. QR-Code für den Einlass) in der Ticketkategorie, die die
            Veranstalter:innen dafür festgelegt haben; wer keine Schichten mehr hat, bekommt eine Absage (außer die Zusage
            ist schon bezahlt oder eingelöst). Hat dieselbe E-Mail-Adresse hier schon eine eigene Zusage, bleibt diese
            unverändert, und wir teilen Schichten nur mit, dass es sie gibt. Wir übermitteln an Schichten keine weiteren
            Daten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Organisation der Veranstaltung, zu der die Helfer*innen
            gehören).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11b. Wichteln</h2>
          <p className="mt-2">
            Veranstalter:innen können einen Termin mit einem Wichteln in der separaten Anwendung „Wichteln“ unter{' '}
            <code>{wichtelnHost}</code> verknüpfen. Wichteln ist ein eigenständiges Angebot mit einer eigenen
            Datenschutzerklärung. Ist ein Termin nicht verknüpft, passiert nichts.
          </p>
          <p className="mt-2">
            Bei einem verknüpften Termin fragt Wichteln uns nach den Zusagen und bekommt von uns für jede Zusage mit
            E-Mail-Adresse <strong>deinen Namen und deine E-Mail-Adresse</strong> - keine Begleitungen und keine weiteren
            Angaben. Wichteln lädt dich damit per Mail zum Wichteln ein; ob du mitmachst, entscheidest du dort. Ändert sich
            eine Zusage, schicken wir Wichteln nur einen Hinweis mit den Kennungen der beiden Termine (ohne Namen), damit es
            die Liste neu abfragt. Im Antwortformular kannst du „Beim Wichteln mitmachen“ abwählen - dann geben wir deine
            Angaben nicht an Wichteln weiter. Ziehst du deine Zusage zurück oder wählst das Wichteln ab, lädt Wichteln dich
            wieder aus, solange du dort noch nicht mitmachst. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse der Veranstalter:innen, die
            Gäste ihrer Veranstaltung zum Wichteln einzuladen).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Fotoalbum</h2>
          <p className="mt-2">
            Veranstalter:innen können zu einem Termin einen Link zu einem geteilten Fotoalbum hinterlegen (z.B. ein
            Album in Immich mit Upload-Freigabe). Gäste mit Zusage sehen ihn auf ihrer persönlichen Seite ab dem Ende
            des Termins. Wir speichern nur diesen Link und übermitteln dem Album keine Daten über dich.
          </p>
          <p className="mt-2">
            Das Album ist ein eigenständiges Angebot der Veranstalter:innen bzw. des jeweiligen Betreibers. Was dort mit
            deinen Fotos und Daten geschieht (z.B. beim Hochladen), richtet sich nach dessen Datenschutzhinweisen; wir
            haben darauf keinen Zugriff.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">13. Zugriff durch Veranstalter:innen und Moderator:innen</h2>
          <p className="mt-2">
            Deine Angaben zu einer Veranstaltung (einschließlich E-Mail-Adresse, Handynummer, Essenswunsch und
            Allergien sowie Ticket- und Zahlungsstatus) sind für die Veranstalter:in einsehbar, die diese Veranstaltung
            angelegt hat, und können von ihr als Liste exportiert werden. Zusätzlich kann sie einzelnen weiteren Konten
            Moderations-Rechte für eine bestimmte Veranstaltung oder Reihe einräumen; diese sehen dann dieselbe
            Gästeliste und können Antworten pflegen, Zahlungen als eingegangen markieren (z.B. an der Abendkasse) sowie
            den Einlass abwickeln. Administrator:innen dieser Instanz haben technisch bedingt Zugriff auf
            alle Daten. Ein Zugriff durch andere Veranstalter:innen ohne eine solche Freigabe findet nicht statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">14. API-Zugang für eigene Apps</h2>
          <p className="mt-2">
            Du kannst dir in den Konto-Einstellungen einen API-Token erzeugen, um mit einer selbst
            entwickelten App (z.B. auf einer Smartwatch) deine Termine abzurufen und zu- oder abzusagen. Ein
            solcher Token gibt ausschließlich <strong>deine eigenen</strong> Daten heraus - deine Reihen, deine
            Termine und deine Antworten, bei Terminen mit verknüpfter Abstimmung auch deinen persönlichen
            Abstimmungslink (10 Minuten gültig, mit deiner E-Mail-Adresse und deiner Zusage). Gästelisten oder
            Angaben anderer Personen sind darüber nicht erreichbar, ebenso wenig der Veranstalter:innen-Bereich. Bei
            Reihen mit öffentlicher Gästeliste (Punkt 7) liefert die Schnittstelle zusätzlich nur die Summen der
            Antworten je Termin (wie viele zugesagt, abgesagt oder auf der Warteliste sind), ohne Namen.
          </p>
          <p className="mt-2">
            Wir speichern zu jedem Token seinen Namen, das Erstellungsdatum und den Zeitpunkt der letzten
            Nutzung - letzteres, damit du erkennst, welches Gerät noch aktiv ist. Der Token selbst wird nur als
            Hash gespeichert und dir genau einmal im Klartext angezeigt. Du kannst jeden Token jederzeit
            einzeln widerrufen; dein Konto bleibt davon unberührt. Verwendest du diese Funktion nicht, wird
            auch nichts davon gespeichert. Bitte beachte, dass eine App, in die du den Token einträgst, damit
            in deinem Namen antworten kann - gib ihn deshalb nicht weiter.
          </p>
          <p className="mt-2">
            <strong>Für Veranstalter:innen (Verwaltungskonten):</strong> Auch hier lässt sich in den Konto-Einstellungen
            ein Token erzeugen, mit dem ein eigenes Programm Termine und die Küchenübersicht <strong>nur lesen</strong>
            kann - genau die Termine, auf die das Konto auch in der Verwaltung Zugriff hat. Dabei werden die Namen der
            angemeldeten Personen, ihre Menüwahl und ihr Tisch übertragen, Essenswünsche und Allergien einzelner
            Personen dagegen nicht (nur deren Anzahl). Wer einen solchen Token in ein Programm einträgt, ist für die
            dort verarbeiteten Daten der Gäste mitverantwortlich. Gespeichert werden wie oben Name, Erstellungsdatum,
            letzte Nutzung und der Hash des Tokens; er gilt bis zum Widerruf und wird mit dem Konto gelöscht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">15. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TDDDG) - dafür ist keine Einwilligung erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>__Host-session</code> - Login-Sitzung in der Verwaltung (30 Tage)</li>
            <li><code>__Host-guest-session</code> - Login-Sitzung in &quot;Mein Konto&quot; (30 Tage)</li>
            <li><code>__Host-suite-state</code> - nur während der Anmeldung über ein anderes Tool (10 Minuten)</li>
            <li><code>event_pin_&lt;id&gt;</code> / <code>series_pin_&lt;id&gt;</code> - Freischaltung passwortgeschützter Veranstaltungen (30 Tage)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg">16. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Bestätigungs-, Erinnerungs-, Verifizierungs- und Passwort-Reset-E-Mails
            versenden wir über den E-Mail-Server <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht,
            soweit es sich um einen externen Anbieter handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28
            DSGVO.
          </p>
          <p className="mt-2">
            <strong>Web-Push-Benachrichtigungen:</strong> Hast du Push-Benachrichtigungen aktiviert (siehe Punkt 6 -
            als Gast oder als Veranstalter:in), werden diese technisch über den Push-Dienst deines jeweiligen
            Browser-Herstellers (z.B. Google, Mozilla, Apple) ausgeliefert. Dabei können Kurzinformationen wie ein
            Veranstaltungstitel, ein Termin oder ein Gästename sowie die IP-Adresse des Empfangsgeräts an Server dieser
            Anbieter übertragen werden, die sich auch außerhalb der EU/des EWR befinden können. Die Funktion betrifft
            ausschließlich Geräte, auf denen sie zuvor aktiv aktiviert wurde.
          </p>
          <p className="mt-2">
            <strong>Verlinkte Abstimmungs-Anwendung:</strong> Beim Klick auf einen Abstimmungs-Link kann deine
            E-Mail-Adresse an die verlinkte Anwendung übermittelt werden - die Einzelheiten dazu stehen in Punkt 9. Beim
            Klick auf &quot;Feedback geben&quot; geht dorthin nur ein Pseudonym deiner Antwort (ebenfalls Punkt 9).
          </p>
          <p className="mt-2">
            <strong>Sitzplatz-Anwendung:</strong> Für Termine, die mit Seating (<code>{seatingHost}</code>) verknüpft
            sind, gehen Name, ggf. E-Mail-Adresse und ggf. Name der Begleitung einer bestätigten Zusage dorthin -
            die Einzelheiten dazu stehen in Punkt 10.
          </p>
          <p className="mt-2">
            <strong>Zeitplan-Anwendung:</strong> Für Termine, die mit der Zeitplan-Anwendung
            (<code>{timelineHost}</code>) verknüpft sind, gehen nur Kennungen einer bestätigten Zusage und ob sie gilt
            dorthin, keine Namen oder Adressen - die Einzelheiten dazu stehen in Punkt 11.
          </p>
          <p className="mt-2">
            <strong>Verbundene Tools:</strong> Die in Punkt 3 beschriebene Anmeldung mit Konten anderer Tools
            überträgt bei Verwaltungskonten Konto-Kennung, E-Mail-Adresse und Rolle, bei Teilnehmendenkonten - nur nach
            deiner Zustimmung - deinen Namen und eine nur für das jeweilige Tool gültige Kennung. Beides nur an Tools,
            die der Betreiber selbst betreibt und freigegeben hat.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Die Daten liegen nur dort; einen externen Hosting-Anbieter gibt es nicht.
          </p>
          <p className="mt-2">
            <strong>Cloudflare (Erreichbarkeit und Schutz):</strong> Der Server ist nicht direkt aus dem Internet erreichbar.
            Alle Aufrufe dieser Anwendung laufen verschlüsselt über das Netz der Cloudflare, Inc. (101 Townsend St., San
            Francisco, CA 94107, USA), das die Verbindung zum Server herstellt (Cloudflare Tunnel) und ihn vor Angriffen und
            Überlastung schützt. Dabei verarbeitet Cloudflare technisch zwangsläufig alles, was beim Aufruf übertragen wird
            - IP-Adresse, Browserangaben, Cookies und die Inhalte von Seiten und Formularen - und führt dazu Protokolle;
            öffentliche Dateien wie Bilder und Skripte können bei Cloudflare zwischengespeichert werden. Cloudflare handelt
            als Auftragsverarbeiter (Art. 28 DSGVO) nach dem Auftragsverarbeitungsvertrag, der Teil der
            Nutzungsbedingungen von Cloudflare ist. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und
            zuverlässigen Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare ist nach dem EU-US Data Privacy Framework
            zertifiziert (Angemessenheitsbeschluss, Art. 45 DSGVO); zusätzlich gelten die Standardvertragsklauseln der
            EU-Kommission. Mehr unter{' '}
            <a href="https://www.cloudflare.com/de-de/privacypolicy/" className="underline">cloudflare.com/privacypolicy</a>.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">17. Speicherdauer</h2>
          <p className="mt-2">
            Deine Daten zu einer Veranstaltung werden spätestens <strong>18 Monate nach dem Veranstaltungsdatum</strong>{' '}
            automatisch vollständig gelöscht - inklusive des Veranstaltungs-Datensatzes selbst, nicht nur deiner
            Antwort. Bei Veranstaltungsreihen bleibt dein Profil (Name, Kontaktdaten, Essenswunsch, Allergien)
            erhalten, solange du noch zu einem jüngeren Termin derselben Reihe geantwortet hast - sind alle deine
            Termine der Reihe älter als 18 Monate, wird auch dieses Profil automatisch gelöscht. Ticket- und
            Zahlungsangaben (Punkt 4) hängen an deiner Antwort und werden mit ihr gelöscht; müssen Veranstalter:innen
            Zahlungen länger nachweisen (z.B. für eine Vereinsbuchhaltung), sichern sie dafür selbst einen Export.
            Der Erinnerungszeitpunkt bei „vielleicht“ wird gelöscht, sobald du zu- oder absagst oder die Antwort am
            Stichtag zur Absage wird.
          </p>
          <p className="mt-2">
            Löschen Veranstalter:innen einen Termin, eine Einladung oder deine Antwort schon vorher, werden deine Angaben
            dazu{' '}<strong>sofort</strong> gelöscht (samt Push-Abo und persönlichem Link). Einladungen werden mit dem
            Termin gelöscht. Ein Reihen-Profil bleibt nur, solange
            du noch zu einem anderen Termin derselben Reihe geantwortet hast.
          </p>
          <p className="mt-2">
            Ein Teilnehmendenkonto unter &quot;Mein Konto&quot; wird automatisch vollständig gelöscht, wenn du dich{' '}
            <strong>2 Jahre</strong> lang nicht mehr eingeloggt hast - inklusive aller Reihen-Zuordnungen, Antworten und
            Freigaben für andere Tools. Ist es mit einem Verwaltungskonto verknüpft, zählt jede Anmeldung in der
            Verwaltung auch als Login hier. Verwaltungskonten (Veranstalter:innen) sind von dieser automatischen Löschung
            ausgenommen. Entziehst du eine Freigabe für ein anderes Tool, bleibt nur der Vermerk samt Kennung bis zur
            Löschung deines Kontos stehen - damit du bei einer erneuten Freigabe dort dieselbe Person bist (z.B. nicht
            doppelt abstimmst).
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Passwort-Reset- und E-Mail-Änderungs-Links nach 1 Stunde; abgelaufene
            Sitzungen werden bei der nächsten Anmeldung entfernt. Die Zähler der Anmelde-Drosselung (Punkt 3) werden
            nach spätestens 24 Stunden gelöscht.
          </p>
          <p className="mt-2">
            Gespeicherte Push-Abos werden gelöscht, sobald du die Benachrichtigungen deaktivierst, dein Browser das Abo
            beendet (z.B. beim Löschen der Websitedaten) oder die zugehörigen Daten nach den oben genannten Fristen
            entfallen. API-Token (Punkt 14) bleiben bis zu ihrem Widerruf gespeichert und werden zusammen mit dem
            Konto gelöscht.
          </p>
          <p className="mt-2">
            Unabhängig von diesen automatischen Fristen kannst du deine Daten jederzeit früher über die in Punkt 18
            beschriebenen Selbstbedienungs-Funktionen löschen oder uns unter der oben genannten Kontaktadresse um
            frühere Löschung bitten.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">18. Deine Rechte</h2>
          <p className="mt-2">
            Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO),
            Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und Widerspruch (Art.
            21 DSGVO) sowie das Recht, eine erteilte Einwilligung jederzeit mit Wirkung für die Zukunft zu widerrufen
            (Art. 7 Abs. 3 DSGVO). Bitte kontaktiere uns dafür über die oben genannte Adresse.
          </p>
          <p className="mt-2">
            <strong>Selbstbedienung:</strong> Über deinen persönlichen Bearbeitungslink (den du nach jeder Anmeldung
            per E-Mail bzw. auf der Erfolgsseite erhältst) kannst du deine Angaben jederzeit ändern und über die
            Schaltfläche &quot;Meine Daten vollständig löschen&quot; sofort und eigenständig löschen - bei
            Veranstaltungsreihen betrifft das alle deine Antworten der gesamten Reihe, nicht nur einen einzelnen
            Termin. Hast du zusätzlich ein Konto unter &quot;Mein Konto&quot;, findest du dort unter &quot;⚙️
            Konto-Einstellungen&quot; eine Schaltfläche, um dieses Konto jederzeit vollständig zu löschen. An
            derselben Stelle (bzw. bei Verwaltungskonten unter &quot;⚙️ Konto-Einstellungen&quot; im Dashboard) kannst du
            dein Passwort und deine E-Mail-Adresse jederzeit selbst ändern - eine E-Mail-Änderung wird erst nach
            Bestätigung über einen an die neue Adresse geschickten Link wirksam. Ebenfalls dort steuerst du, ob du
            Bestätigungs-Mails erhalten möchtest (Punkt 5) und welche anderen Tools dich mit deinem Teilnehmendenkonto
            anmelden dürfen (&quot;Anmeldung in anderen Tools&quot;, Punkt 3 - dort entziehst du eine Freigabe);
            Push-Benachrichtigungen deaktivierst du direkt auf der jeweiligen Termin-Seite bzw. im Dashboard (Punkt 6).
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">19. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Login-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter, Sitzungs-Tokens und Einmal-Links werden ausschließlich als Hash
            gespeichert (eine Kopie der Datenbank ermöglicht keinen Zugang zu Konten), persönliche Bearbeitungslinks
            und Sitzungs-Tokens werden kryptographisch sicher zufällig erzeugt, und wiederholte Fehlversuche bei der
            Anmeldung werden gebremst.
          </p>
        </div>

        <div className="pt-6 border-t dark:border-gray-700">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
