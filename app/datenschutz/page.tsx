// app/datenschutz/page.tsx
import Link from 'next/link'

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
            Push-Benachrichtigungen (Punkt 6) Art. 6 Abs. 1 lit. a bzw. Art. 9 Abs. 2 lit. a DSGVO (Einwilligung durch
            das Ausfüllen des jeweiligen Feldes bzw. das aktive Aktivieren der Funktion).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Registrierung & Login (Admin-Konten und &quot;Mein Konto&quot;)</h2>
          <p className="mt-2">
            Für Veranstalter:innen (E-Mail, Passwort-Hash) und für Gäste, die sich freiwillig ein Nutzer-Konto unter
            &quot;Mein Konto&quot; anlegen (E-Mail, Passwort-Hash, Name, optional Handynummer/Essenswunsch/Allergien),
            speichern wir Login-Daten. Passwörter werden ausschließlich als Hash (bcrypt) gespeichert, niemals im
            Klartext. Die Anmeldung erfolgt über ein zufällig erzeugtes Sitzungs-Token in einem Cookie (siehe Punkt 12)
            - niemals über deinen Namen oder deine E-Mail-Adresse direkt im Cookie. Bei einem Nutzer-Konto speichern
            wir außerdem den Zeitpunkt deines letzten Logins, um das Konto nach längerer Inaktivität automatisch
            löschen zu können (siehe Punkt 13).
          </p>
          <p className="mt-2">
            <strong>Sicherer Umgang mit Zugangsdaten:</strong> Passwörter werden mit bcrypt gehasht. Auch
            Sitzungs-Tokens sowie die Einmal-Links für Passwort-Reset, E-Mail-Änderung und die Bestätigung eines
            Nutzer-Kontos speichern wir in der Datenbank <strong>nur als Hash</strong> - der Klartext steht allein
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
            <strong>Anmeldung mit dem Konto eines anderen Tools (optional, nur Admin-Konten):</strong> Ist dies vom
            Betreiber eingerichtet, kannst du dich hier mit einem Konto eines verbundenen Tools anmelden (z.B. dem
            Abstimmungstool), und umgekehrt kann man sich dort mit einem Konto von hier anmelden. Das geschieht{' '}
            <strong>nur, wenn du es aktiv anstößt</strong>, und nur zwischen Tools, die der Betreiber ausdrücklich
            freigegeben hat. Dabei übermittelt das Tool, bei dem du angemeldet bist, an das andere eine etwa eine
            Minute gültige, digital signierte Bestätigung mit <strong>deiner Konto-Kennung, E-Mail-Adresse und
            Rolle</strong> - niemals dein Passwort oder deine Sitzung. Die Verknüpfung speichern wir und du kannst
            sie unter &quot;⚙️ Konto-Einstellungen&quot; jederzeit entfernen. Nutzer-Konten für Veranstaltungsreihen
            (&quot;Mein Konto&quot;) nehmen daran nicht teil.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Angaben im RSVP-Formular</h2>
          <p className="mt-2">
            Je nach Konfiguration der jeweiligen Veranstaltung fragen wir Name (Pflichtfeld), E-Mail-Adresse,
            Handynummer, Essenswunsch, Begleitperson, Alkohol-Präferenz, Mitbringsel und freie Zusatzfragen ab. Diese
            Angaben verwenden wir ausschließlich zur Organisation und Durchführung der jeweiligen Veranstaltung. Wir
            geben deine Daten nicht an Dritte außerhalb der in Punkt 13 genannten Auftragsverarbeiter weiter.
          </p>
          <p className="mt-2">
            <strong>Allergien/Unverträglichkeiten:</strong> Dieses Feld ist stets freiwillig und optional. Da
            Gesundheitsangaben eine besondere Kategorie personenbezogener Daten nach Art. 9 DSGVO darstellen können,
            verarbeiten wir sie ausschließlich auf Basis deiner ausdrücklichen Einwilligung, die du durch das
            freiwillige Ausfüllen dieses Feldes erteilst (Art. 9 Abs. 2 lit. a DSGVO). Du kannst diese Einwilligung
            jederzeit mit Wirkung für die Zukunft widerrufen, z.B. indem du deine Angabe über deinen persönlichen Link
            entfernst oder deine Daten vollständig löschst (siehe Punkt 15).
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
            Warteliste sowie automatische oder manuelle Erinnerungen vor der Veranstaltung.
          </p>
          <p className="mt-2">
            <strong>Änderungs-Mitteilungen:</strong> Ändert die Veranstalter:in nach deiner Zusage wesentliche Angaben
            zum Termin (Titel, Datum, Dauer, Ort oder Beschreibung), kann sie alle bereits zugesagten Gäste darüber
            informieren. Du erhältst diese Mitteilung per E-Mail und - falls du Push-Benachrichtigungen aktiviert hast
            - zusätzlich als Push-Benachrichtigung (siehe Punkt 6).
          </p>
          <p className="mt-2">
            <strong>Bestätigungs-Mails abbestellen:</strong>{' '}Hast du ein Nutzer-Konto unter &quot;Mein Konto&quot; und
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
              <strong>Als Gast:</strong> Erinnerungen an bevorstehende Termine, Mitteilungen über Termin-Änderungen
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
            damit verbundene Datenübermittlung ist in Punkt 13 beschrieben. Du kannst die Benachrichtigungen jederzeit
            an derselben Stelle wieder deaktivieren oder die Erlaubnis in den Einstellungen deines Browsers entziehen;
            das gespeicherte Abo wird dann gelöscht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. Öffentliche Gästeliste</h2>
          <p className="mt-2">
            Manche Veranstaltungen zeigen optional eine öffentliche Gästeliste, auf der andere Gäste sehen können, wer
            zugesagt hat, wer eine Begleitung mitbringt und wer welches Mitbringsel beisteuert. Dort wird
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
            wir den Zeitpunkt deines Check-ins. Dies dient ausschließlich der Zutrittskontrolle vor Ort.
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
            Bist du zu diesem Zeitpunkt mit einem bestätigten Nutzer-Konto unter &quot;Mein Konto&quot; angemeldet,
            übermitteln wir dabei <strong>deine E-Mail-Adresse</strong> in einem kryptographisch signierten,{' '}
            <strong>nur 10 Minuten gültigen</strong> Token an die verlinkte Abstimmung. Das dient ausschließlich dazu,
            dich dort als bereits bestätigte Person auszuweisen, damit du nicht erneut eine Verifizierung durchlaufen
            musst. Weitere Angaben (Name, Handynummer, Essenswunsch, Allergien, deine Antworten) werden dabei nicht
            übertragen, ebenso wenig dein Passwort oder deine Sitzung. Bist du nicht angemeldet, führt derselbe Link
            ohne jede Übermittlung personenbezogener Daten zur Abstimmung.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Zugriff durch Veranstalter:innen und Moderator:innen</h2>
          <p className="mt-2">
            Deine Angaben zu einer Veranstaltung (einschließlich E-Mail-Adresse, Handynummer, Essenswunsch und
            Allergien) sind für die Veranstalter:in einsehbar, die diese Veranstaltung angelegt hat, und können von ihr
            als Liste exportiert werden. Zusätzlich kann sie einzelnen weiteren Konten Moderations-Rechte für eine
            bestimmte Veranstaltung oder Reihe einräumen; diese sehen dann dieselbe Gästeliste und können Antworten
            pflegen sowie den Einlass abwickeln. Administrator:innen dieser Instanz haben technisch bedingt Zugriff auf
            alle Daten. Ein Zugriff durch andere Veranstalter:innen ohne eine solche Freigabe findet nicht statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. API-Zugang für eigene Apps</h2>
          <p className="mt-2">
            Du kannst dir in den Konto-Einstellungen einen API-Token erzeugen, um mit einer selbst
            entwickelten App (z.B. auf einer Smartwatch) deine Termine abzurufen und zu- oder abzusagen. Ein
            solcher Token gibt ausschließlich <strong>deine eigenen</strong> Daten heraus - deine Reihen, deine
            Termine und deine Antworten. Gästelisten oder Angaben anderer Personen sind darüber nicht
            erreichbar, ebenso wenig der Veranstalter:innen-Bereich.
          </p>
          <p className="mt-2">
            Wir speichern zu jedem Token seinen Namen, das Erstellungsdatum und den Zeitpunkt der letzten
            Nutzung - letzteres, damit du erkennst, welches Gerät noch aktiv ist. Der Token selbst wird nur als
            Hash gespeichert und dir genau einmal im Klartext angezeigt. Du kannst jeden Token jederzeit
            einzeln widerrufen; dein Konto bleibt davon unberührt. Verwendest du diese Funktion nicht, wird
            auch nichts davon gespeichert. Bitte beachte, dass eine App, in die du den Token einträgst, damit
            in deinem Namen antworten kann - gib ihn deshalb nicht weiter.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TTDSG) - dafür ist keine Einwilligung erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>__Host-session</code> - Login-Sitzung im Admin-Bereich (30 Tage)</li>
            <li><code>__Host-guest-session</code> - Login-Sitzung in &quot;Mein Konto&quot; (30 Tage)</li>
            <li><code>__Host-suite-state</code> - nur während der Anmeldung über ein anderes Tool (10 Minuten)</li>
            <li><code>event_pin_&lt;id&gt;</code> / <code>series_pin_&lt;id&gt;</code> - Freischaltung passwortgeschützter Veranstaltungen (30 Tage)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg">13. Empfänger und Auftragsverarbeiter</h2>
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
            E-Mail-Adresse an die verlinkte Anwendung übermittelt werden - die Einzelheiten dazu stehen in Punkt 9.
          </p>
          <p className="mt-2">
            <strong>Verbundene Tools:</strong> Die in Punkt 3 beschriebene Anmeldung mit Konten anderer Tools
            überträgt Konto-Kennung, E-Mail-Adresse und Rolle nur an Tools, die der Betreiber selbst betreibt und
            freigegeben hat.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Rohdaten an einen externen
            Hosting-Anbieter statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">14. Speicherdauer</h2>
          <p className="mt-2">
            Deine Daten zu einer Veranstaltung werden spätestens <strong>18 Monate nach dem Veranstaltungsdatum</strong>{' '}
            automatisch vollständig gelöscht - inklusive des Veranstaltungs-Datensatzes selbst, nicht nur deiner
            Antwort. Bei Veranstaltungsreihen bleibt dein Profil (Name, Kontaktdaten, Essenswunsch, Allergien)
            erhalten, solange du noch zu einem jüngeren Termin derselben Reihe geantwortet hast - sind alle deine
            Termine der Reihe älter als 18 Monate, wird auch dieses Profil automatisch gelöscht.
          </p>
          <p className="mt-2">
            Ein Nutzer-Konto unter &quot;Mein Konto&quot; wird automatisch vollständig gelöscht, wenn du dich{' '}
            <strong>2 Jahre</strong> lang nicht mehr eingeloggt hast - inklusive aller Reihen-Zuordnungen und
            Antworten. Admin-Konten (Veranstalter:innen) sind von dieser automatischen Löschung ausgenommen.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Passwort-Reset- und E-Mail-Änderungs-Links nach 1 Stunde; abgelaufene
            Sitzungen werden bei der nächsten Anmeldung entfernt. Die Zähler der Anmelde-Drosselung (Punkt 3) werden
            nach spätestens 24 Stunden gelöscht.
          </p>
          <p className="mt-2">
            Gespeicherte Push-Abos werden gelöscht, sobald du die Benachrichtigungen deaktivierst, dein Browser das Abo
            beendet (z.B. beim Löschen der Websitedaten) oder die zugehörigen Daten nach den oben genannten Fristen
            entfallen. API-Token (Punkt 11) bleiben bis zu ihrem Widerruf gespeichert und werden zusammen mit dem
            Konto gelöscht.
          </p>
          <p className="mt-2">
            Unabhängig von diesen automatischen Fristen kannst du deine Daten jederzeit früher über die in Punkt 14
            beschriebenen Selbstbedienungs-Funktionen löschen oder uns unter der oben genannten Kontaktadresse um
            frühere Löschung bitten.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">15. Deine Rechte</h2>
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
            derselben Stelle (bzw. bei Admin-Konten unter &quot;⚙️ Konto-Einstellungen&quot; im Dashboard) kannst du
            dein Passwort und deine E-Mail-Adresse jederzeit selbst ändern - eine E-Mail-Änderung wird erst nach
            Bestätigung über einen an die neue Adresse geschickten Link wirksam. Ebenfalls dort steuerst du, ob du
            Bestätigungs-Mails erhalten möchtest (Punkt 5); Push-Benachrichtigungen deaktivierst du direkt auf der
            jeweiligen Termin-Seite bzw. im Dashboard (Punkt 6).
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">16. Datensicherheit</h2>
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
