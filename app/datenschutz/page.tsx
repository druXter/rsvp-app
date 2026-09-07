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
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Datenschutzerklärung</h1>

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
          <p className="mt-2 text-sm text-gray-600">
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
            freiwillige Zusatzangaben (z.B. Allergien, siehe Punkt 4) Art. 6 Abs. 1 lit. a bzw. Art. 9 Abs. 2 lit. a
            DSGVO (Einwilligung durch das Ausfüllen des jeweiligen Feldes).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Registrierung & Login (Admin-Konten und &quot;Mein Konto&quot;)</h2>
          <p className="mt-2">
            Für Veranstalter:innen (E-Mail, Passwort-Hash) und für Gäste, die sich freiwillig ein Nutzer-Konto unter
            &quot;Mein Konto&quot; anlegen (E-Mail, Passwort-Hash, Name, optional Handynummer/Essenswunsch/Allergien),
            speichern wir Login-Daten. Passwörter werden ausschließlich als Hash (bcrypt) gespeichert, niemals im
            Klartext. Die Anmeldung erfolgt über ein zufällig erzeugtes Sitzungs-Token in einem Cookie (siehe Punkt 7)
            - niemals über deinen Namen oder deine E-Mail-Adresse direkt im Cookie.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Angaben im RSVP-Formular</h2>
          <p className="mt-2">
            Je nach Konfiguration der jeweiligen Veranstaltung fragen wir Name (Pflichtfeld), E-Mail-Adresse,
            Handynummer, Essenswunsch, Begleitperson, Alkohol-Präferenz, Mitbringsel und freie Zusatzfragen ab. Diese
            Angaben verwenden wir ausschließlich zur Organisation und Durchführung der jeweiligen Veranstaltung. Wir
            geben deine Daten nicht an Dritte außerhalb der in Punkt 8 genannten Auftragsverarbeiter weiter.
          </p>
          <p className="mt-2">
            <strong>Allergien/Unverträglichkeiten:</strong> Dieses Feld ist stets freiwillig und optional. Da
            Gesundheitsangaben eine besondere Kategorie personenbezogener Daten nach Art. 9 DSGVO darstellen können,
            verarbeiten wir sie ausschließlich auf Basis deiner ausdrücklichen Einwilligung, die du durch das
            freiwillige Ausfüllen dieses Feldes erteilst (Art. 9 Abs. 2 lit. a DSGVO). Du kannst diese Einwilligung
            jederzeit mit Wirkung für die Zukunft widerrufen, z.B. indem du deine Angabe über deinen persönlichen Link
            entfernst oder deine Daten vollständig löschst (siehe Punkt 9).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. E-Mail-Bestätigung (Double-Opt-In) & Erinnerungen</h2>
          <p className="mt-2">
            Ist für eine Veranstaltung die E-Mail-Bestätigung aktiviert, verschicken wir dir einen Bestätigungslink,
            bevor deine Anmeldung gültig wird - das schützt dich und uns vor missbräuchlichen Anmeldungen unter
            fremdem Namen. Zusätzlich kannst du automatische oder manuelle Erinnerungs-E-Mails vor der Veranstaltung
            erhalten, sofern du eine E-Mail-Adresse hinterlegt hast.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Öffentliche Gästeliste</h2>
          <p className="mt-2">
            Manche Veranstaltungen zeigen optional eine öffentliche Gästeliste, auf der andere Gäste sehen können, wer
            zugesagt hat, wer eine Begleitung mitbringt und wer welches Mitbringsel beisteuert. Dort wird
            ausschließlich dein <strong>Name</strong> angezeigt - deine E-Mail-Adresse, Handynummer und Allergien
            werden dabei niemals veröffentlicht. Ist diese Funktion für eine Veranstaltung aktiv, weisen wir dich im
            RSVP-Formular selbst noch einmal ausdrücklich darauf hin, bevor du deine Zusage absendest.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. QR-Code-Einlasskontrolle</h2>
          <p className="mt-2">
            Ist für eine Veranstaltung die Einlasskontrolle aktiviert, erhältst du bei einer bestätigten Zusage einen
            persönlichen QR-Code (per E-Mail und auf der Erfolgsseite). Wird dieser beim Einlass gescannt, speichern
            wir den Zeitpunkt deines Check-ins. Dies dient ausschließlich der Zutrittskontrolle vor Ort.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">8. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TTDSG) - dafür ist keine Einwilligung erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>session_token</code> - Login-Sitzung im Admin-Bereich (30 Tage)</li>
            <li><code>guest_session_token</code> - Login-Sitzung in &quot;Mein Konto&quot; (30 Tage)</li>
            <li><code>event_pin_&lt;id&gt;</code> / <code>series_pin_&lt;id&gt;</code> - Freischaltung passwortgeschützter Veranstaltungen (30 Tage)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Bestätigungs-, Erinnerungs-, Verifizierungs- und Passwort-Reset-E-Mails
            versenden wir über den E-Mail-Server <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht,
            soweit es sich um einen externen Anbieter handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28
            DSGVO.
          </p>
          <p className="mt-2">
            <strong>Web-Push-Benachrichtigungen:</strong> Veranstalter:innen können sich optional für
            Push-Benachrichtigungen über neue Zu-/Absagen anmelden. Diese werden technisch über den
            Push-Dienst deines jeweiligen Browser-Herstellers (z.B. Google, Mozilla, Apple) ausgeliefert - dabei
            können Kurzinformationen wie ein Gästename sowie die IP-Adresse des Empfangsgeräts an Server dieser
            Anbieter übertragen werden, die sich auch außerhalb der EU/des EWR befinden können. Diese Funktion
            betrifft ausschließlich das Gerät der Veranstalter:in, die sich aktiv dafür angemeldet hat, nicht die
            Geräte der Gäste.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Rohdaten an einen externen
            Hosting-Anbieter statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Speicherdauer</h2>
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
            Unabhängig von diesen automatischen Fristen kannst du deine Daten jederzeit früher über die in Punkt 11
            beschriebenen Selbstbedienungs-Funktionen löschen oder uns unter der oben genannten Kontaktadresse um
            frühere Löschung bitten.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. Deine Rechte</h2>
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
            Termin. Hast du zusätzlich ein Konto unter &quot;Mein Konto&quot;, kannst du dieses dort jederzeit
            vollständig löschen (&quot;Konto & alle Daten unwiderruflich löschen&quot;).
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Login-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter werden ausschließlich als Hash gespeichert, persönliche
            Bearbeitungslinks und Sitzungs-Tokens werden kryptographisch sicher zufällig erzeugt.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
