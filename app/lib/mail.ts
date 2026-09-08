// app/lib/mail.ts
import nodemailer from 'nodemailer'
import { createEvent, DateArray } from 'ics'
import { Event, EventSeries, GuestUser, Participant, Rsvp, User } from '@prisma/client'
import { generateCheckinQrBuffer } from './qrcode'

// Den Mail-Transporter mit den Daten aus der .env initialisieren
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // Port 465 nutzt direkt TLS, andere Ports (wie 587) nutzen STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// Ein Event, das optional (bei Reihen-Terminen) seine EventSeries mitbringt.
type EventWithSeries = Event & { series?: EventSeries | null }

const baseUrl = () => process.env.BASE_URL || 'http://localhost:3000'

/**
 * Persönlicher Link für einen Participant zu genau EINEM Termin. Bei Reihen-Terminen
 * führt der Link über die Reihen-Route, bei Einzel-Events direkt auf den Event-Slug.
 */
function personalEventLink(event: EventWithSeries, participant: Participant) {
  if (event.series) {
    return `${baseUrl()}/reihe/${event.series.slug}/${event.slug}?token=${participant.editToken}`
  }
  return `${baseUrl()}/${event.slug}?token=${participant.editToken}`
}

/**
 * Link zur Reihen-Übersicht (alle Termine), personalisiert mit dem Participant-Token,
 * damit Kontakt-/Profildaten dort vorausgefüllt sind.
 */
function seriesOverviewLink(series: EventSeries, participant: Participant) {
  return `${baseUrl()}/reihe/${series.slug}?token=${participant.editToken}`
}

/**
 * Baut, falls der Termin Teil einer Reihe ist, einen Hinweisblock mit Link zu den
 * weiteren Terminen der Reihe (für Bestätigungs-/Wartelisten-Mails).
 */
function seriesHintText(event: EventWithSeries, participant: Participant): string {
  if (!event.series) return ''
  return `\n\nDieser Termin gehört zur Reihe "${event.series.title}". Weitere Termine und deine bisherigen Antworten findest du hier:\n${seriesOverviewLink(event.series, participant)}`
}

function seriesHintHtml(event: EventWithSeries, participant: Participant): string {
  if (!event.series) return ''
  return `<p>Dieser Termin gehört zur Reihe <strong>${event.series.title}</strong>. Weitere Termine und deine bisherigen Antworten findest du <a href="${seriesOverviewLink(event.series, participant)}">hier</a>.</p>`
}

/**
 * Stabile, an die Event-ID gebundene UID für die .ics-Datei eines Termins - anders als
 * eine bei jedem Mail-Versand neu zufällig erzeugte UID erkennen Kalender-Apps (Google/
 * Apple/Outlook) eine erneut verschickte .ics mit gleicher UID und höherer SEQUENCE
 * (siehe icsSequence auf Event, hochgezählt in diffEventFields/updateEvent) als Update
 * des bestehenden Eintrags statt als neuen Duplikat-Eintrag.
 */
function icsUid(event: Event): string {
  let host = 'rsvp-app.local'
  try {
    host = new URL(baseUrl()).host
  } catch {
    // baseUrl() ungültig (z.B. lokale Entwicklung ohne BASE_URL) - Fallback-Host reicht,
    // da nur Eindeutigkeit innerhalb dieser Installation zählt.
  }
  return `event-${event.id}@${host}`
}

/**
 * Baut den .ics-Kalender-Anhang für einen zugesagten Gast. Gemeinsam genutzt von der
 * Bestätigungs- und der Änderungs-Mail, damit beide dieselbe stabile UID/SEQUENCE
 * verwenden (siehe icsUid).
 */
function buildIcsAttachment(event: EventWithSeries, participant: Participant) {
  const date = new Date(event.date)
  const eventDate: DateArray = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes()
  ]

  const personalLink = personalEventLink(event, participant)
  const fullDescription = `${event.description || ''}\n\nAntwort nachträglich bearbeiten: ${personalLink}`

  const { error, value } = createEvent({
    uid: icsUid(event),
    sequence: event.icsSequence,
    title: event.title,
    description: fullDescription,
    location: event.location || '',
    start: eventDate,
    duration: { hours: event.duration },
    startInputType: 'utc',
    startOutputType: 'utc'
  })

  if (error || !value) return null

  return {
    filename: `${event.slug}.ics`,
    content: value,
    contentType: 'text/calendar'
  }
}

/**
 * Generiert die Kalenderdatei und verschickt eine Bestätigungs-E-Mail an den Gast.
 */
export async function sendConfirmationEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const personalLink = personalEventLink(event, participant)

  // Wenn der Gast zusagt, generieren wir die .ics-Datei für den Anhang
  const icsAttachment = rsvp.isAttending ? buildIcsAttachment(event, participant) : null

  // Einlass-QR-Code: Nur für bestätigte Zusagen (sendConfirmationEmail wird für
  // Wartelisten-Fälle nie aufgerufen - siehe sendWaitlistEmail) und nur, wenn
  // der Check-in für diesen Termin aktiviert ist.
  const qrAttachment = rsvp.isAttending && event.enableCheckin
    ? { filename: 'einlass-qrcode.png', content: await generateCheckinQrBuffer(rsvp.id), cid: 'checkinqr', contentType: 'image/png' }
    : null

  // Betreff und Text je nach Zusage oder Absage anpassen
  const subject = rsvp.isAttending
    ? `Zusage bestätigt: ${event.title}`
    : `Absage bestätigt: ${event.title}`

  const text = `Hallo ${participant.name},

vielen Dank für deine Rückmeldung zum Event "${event.title}".

${rsvp.isAttending
  ? 'Wir freuen uns sehr, dass du dabei bist! Im Anhang findest du eine Kalenderdatei (.ics), damit du dir den Termin direkt abspeichern kannst, sowie deinen persönlichen Einlass-QR-Code - bitte am Einlass bereithalten.'
  : 'Schade, dass du nicht dabei sein kannst. Falls sich deine Pläne doch noch ändern sollten, kannst du deine Antwort jederzeit anpassen.'}

Du kannst deine Antwort und alle optionalen Angaben jederzeit über diesen persönlichen Link bearbeiten:
${personalLink}${seriesHintText(event, participant)}

Viele Grüße,
Dein Event-Team`

  const html = `
    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
      <h2>${rsvp.isAttending ? `Zusage bestätigt, ${participant.name}! 🎉` : `Absage bestätigt, ${participant.name}`}</h2>
      <p>Vielen Dank für deine Rückmeldung zum Event <strong>${event.title}</strong>.</p>
      <p>${rsvp.isAttending
        ? 'Wir freuen uns sehr, dass du dabei bist! Im Anhang findest du eine Kalenderdatei (.ics), damit du dir den Termin direkt abspeichern kannst.'
        : 'Schade, dass du nicht dabei sein kannst. Falls sich deine Pläne doch noch ändern sollten, kannst du deine Antwort jederzeit anpassen.'}</p>
      ${qrAttachment ? `
        <p style="text-align: center; margin: 30px 0;">
          <img src="cid:checkinqr" alt="Einlass-QR-Code" style="width: 220px; height: 220px;" />
          <br>
          <span style="font-size: 13px; color: #666;">Dein persönlicher Einlass-QR-Code - bitte am Einlass bereithalten.</span>
        </p>
      ` : ''}
      <p>Du kannst deine Antwort und alle optionalen Angaben jederzeit über diesen persönlichen Link bearbeiten:</p>
      <p><a href="${personalLink}">${personalLink}</a></p>
      ${seriesHintHtml(event, participant)}
      <p>Viele Grüße,<br>Dein Event-Team</p>
    </div>
  `

  // E-Mail abschicken
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject,
    text,
    html,
    attachments: [icsAttachment, qrAttachment].filter((a): a is NonNullable<typeof a> => a !== null),

    // Zwingt Mail-Server, den korrekten technischen Absender zu akzeptieren
    envelope: {
      from: process.env.SMTP_USER,
      to: participant.email!
    }
  })
}

/**
 * Versendet eine Erinnerungs-E-Mail an einen bestimmten Gast.
 * Akzeptiert eine optionale, benutzerdefinierte Nachricht des Gastgebers.
 */
export async function sendReminderEmail(
  event: EventWithSeries,
  participant: Participant,
  customMessage: string
) {
  const personalLink = personalEventLink(event, participant)

  // Datum in deutsches Format umwandeln
  const formattedDate = new Date(event.date).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  // Wenn ein Zusatztext eingegeben wurde, bauen wir einen hervorgehobenen HTML-Block dafür
  const customMessageHtml = customMessage
    ? `<div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
         <p style="margin: 0; white-space: pre-wrap;"><strong>Nachricht des Gastgebers:</strong><br><br>${customMessage}</p>
       </div>`
    : ''

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject: `Erinnerung: ${event.title} steht bald an!`,
    text: `Hallo ${participant.name},\n\nwir freuen uns, dass du bei "${event.title}" dabei bist!\n\nWann: ${formattedDate} Uhr\nWo: ${event.location || 'Wird noch bekannt gegeben'}\n\n${customMessage ? 'Nachricht des Gastgebers:\n' + customMessage + '\n\n' : ''}Deine Antworten bearbeiten: ${personalLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Wir freuen uns auf dich, ${participant.name}! 🎉</h2>
        <p>Das Event <strong>${event.title}</strong> rückt näher. Hier sind noch einmal alle wichtigen Daten für dich zusammengefasst:</p>

        <ul style="list-style: none; padding: 0;">
          <li>📅 <strong>Wann:</strong> ${formattedDate} Uhr</li>
          <li>📍 <strong>Wo:</strong> ${event.location || 'Wird noch bekannt gegeben'}</li>
        </ul>

        ${customMessageHtml}

        <p>Falls sich an deiner Zusage noch etwas ändert, kannst du deine Daten jederzeit hier anpassen:</p>
        <p><a href="${personalLink}" style="display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px;">Antwort bearbeiten</a></p>

        <p>Bis bald!</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Erinnerung an ${participant.email}:`, error)
    return false
  }
}

/**
 * Versendet eine Verifizierungs-E-Mail (Double-Opt-In), wenn requireVerification aktiv ist.
 * Die Verifizierung gilt für den Participant (und damit reihenweit), nicht für ein einzelnes Rsvp.
 */
export async function sendVerificationEmail(
  participant: Participant,
  event: EventWithSeries
) {
  // Der Bestätigungs-Link leitet auf eine neue Route, die wir gleich noch bauen
  const verifyLink = `${baseUrl()}/verify?token=${participant.verifyToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject: `Bitte bestätige deine Anmeldung für ${event.title}`,
    text: `Hallo ${participant.name},\n\nbitte klicke auf den folgenden Link, um deine E-Mail-Adresse zu bestätigen und deine Anmeldung für "${event.title}" abzuschließen:\n\n${verifyLink}\n\nErst nach der Bestätigung wird deine Anmeldung gültig.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Fast geschafft, ${participant.name}! ✉️</h2>
        <p>Du hast dich für das Event <strong>${event.title}</strong> angemeldet.</p>
        <p>Um Spam zu vermeiden, bitten wir dich, deine E-Mail-Adresse über den folgenden Button zu bestätigen. Erst danach ist deine Anmeldung verbindlich und du erhältst alle weiteren Informationen (inklusive Kalender-Eintrag).</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">E-Mail-Adresse bestätigen</a>
        </p>

        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${verifyLink}</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Verifizierungs-Mail an ${participant.email}:`, error)
    return false
  }
}

/**
 * Versendet die Bestätigungs-E-Mail für ein neu registriertes Nutzer-Konto (siehe #12,
 * app/mein-konto/actions.ts registerGuestUser). Getrennt von sendVerificationEmail, da
 * es hier um das Login-Konto selbst geht, nicht um die Verifizierung einer einzelnen
 * Anmeldung/Participant.
 */
export async function sendGuestVerificationEmail(guestUser: GuestUser, series: EventSeries) {
  const verifyLink = `${baseUrl()}/mein-konto/verify?token=${guestUser.verifyToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: guestUser.email,
    subject: `Bitte bestätige dein Konto für ${series.title}`,
    text: `Hallo ${guestUser.name},\n\ndu hast dir gerade ein Konto für die Reihe "${series.title}" angelegt. Bitte klicke auf den folgenden Link, um dein Konto zu bestätigen - danach kannst du dich einloggen und siehst automatisch alle Termine dieser (und weiterer, dir zugeordneter) Reihen:\n\n${verifyLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Fast geschafft, ${guestUser.name}! ✉️</h2>
        <p>Du hast dir gerade ein Konto für die Reihe <strong>${series.title}</strong> angelegt.</p>
        <p>Bitte bestätige dein Konto über den folgenden Button - danach kannst du dich einloggen und siehst automatisch alle Termine dieser (und weiterer, dir zugeordneter) Reihen, ohne dir Links merken oder Angaben erneut eintragen zu müssen.</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Konto bestätigen</a>
        </p>

        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${verifyLink}</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Nutzer-Verifizierungs-Mail an ${guestUser.email}:`, error)
    return false
  }
}

/**
 * Versendet die Passwort-Reset-Mail für ein Nutzer-Konto (GuestUser, siehe #12/#13,
 * requestGuestPasswordReset in app/mein-konto/actions.ts). Getrennt von
 * sendPasswordResetEmail, da es sich um ein eigenständiges Login-System handelt.
 */
export async function sendGuestPasswordResetEmail(guestUser: GuestUser) {
  const resetLink = `${baseUrl()}/mein-konto/reset-password?token=${guestUser.resetToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: guestUser.email,
    subject: 'Passwort zurücksetzen',
    text: `Hallo ${guestUser.name},\n\nfür dein Konto (${guestUser.email}) wurde ein Passwort-Reset angefordert. Falls du das warst, klicke auf den folgenden Link, um ein neues Passwort zu vergeben:\n\n${resetLink}\n\nDer Link ist eine Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren - dein Passwort bleibt unverändert.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Passwort zurücksetzen</h2>
        <p>Hallo ${guestUser.name}, für dein Konto <strong>${guestUser.email}</strong> wurde ein Passwort-Reset angefordert. Falls du das warst, klicke auf den folgenden Button, um ein neues Passwort zu vergeben:</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Neues Passwort vergeben</a>
        </p>

        <p style="font-size: 12px; color: #666;">Der Link ist eine Stunde gültig. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${resetLink}</p>
        <p style="font-size: 12px; color: #666;">Falls du das nicht warst, kannst du diese E-Mail ignorieren - dein Passwort bleibt unverändert.</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Nutzer-Passwort-Reset-Mail an ${guestUser.email}:`, error)
    return false
  }
}

/**
 * Versendet die Passwort-Reset-Mail für ein Admin-seitiges Benutzerkonto (siehe #13,
 * requestPasswordReset in app/admin/actions.ts). Wird NIE für ein Admin-Konto (role
 * ADMIN) aufgerufen - dort bleibt ein Reset ausschließlich über direkten Server-Zugriff
 * möglich (create-user.js/set-role.js).
 */
export async function sendPasswordResetEmail(user: User) {
  const resetLink = `${baseUrl()}/admin/reset-password?token=${user.resetToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Passwort zurücksetzen',
    text: `Hallo,\n\nfür dein Konto (${user.email}) wurde ein Passwort-Reset angefordert. Falls du das warst, klicke auf den folgenden Link, um ein neues Passwort zu vergeben:\n\n${resetLink}\n\nDer Link ist eine Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren - dein Passwort bleibt unverändert.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Passwort zurücksetzen</h2>
        <p>Für dein Konto <strong>${user.email}</strong> wurde ein Passwort-Reset angefordert. Falls du das warst, klicke auf den folgenden Button, um ein neues Passwort zu vergeben:</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Neues Passwort vergeben</a>
        </p>

        <p style="font-size: 12px; color: #666;">Der Link ist eine Stunde gültig. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${resetLink}</p>
        <p style="font-size: 12px; color: #666;">Falls du das nicht warst, kannst du diese E-Mail ignorieren - dein Passwort bleibt unverändert.</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Passwort-Reset-Mail an ${user.email}:`, error)
    return false
  }
}

/**
 * Versendet den Bestätigungslink für eine E-Mail-Änderung eines Admin-seitigen
 * Benutzerkontos (siehe requestEmailChange in app/admin/actions.ts). Geht an die NEUE
 * Adresse, nicht an die alte - erst der Klick macht die Änderung wirksam. Das ist auch
 * für Admin-Konten sicher, anders als der Passwort-Reset per Mail-Link: hier wurde der
 * Vorgang bereits mit einer aktiven Session UND dem aktuellen Passwort ausgelöst, ein
 * kompromittiertes ALTES Postfach reicht dafür nicht aus.
 */
export async function sendEmailChangeConfirmation(user: User) {
  const confirmLink = `${baseUrl()}/admin/confirm-email?token=${user.emailChangeToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: user.pendingEmail!,
    subject: 'Neue E-Mail-Adresse bestätigen',
    text: `Hallo,\n\nfür dein Konto (aktuell ${user.email}) wurde eine Änderung der E-Mail-Adresse auf diese Adresse angefordert. Falls du das warst, klicke auf den folgenden Link, um die Änderung zu bestätigen:\n\n${confirmLink}\n\nDer Link ist eine Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren - deine E-Mail-Adresse bleibt unverändert.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Neue E-Mail-Adresse bestätigen</h2>
        <p>Für dein Konto (aktuell <strong>${user.email}</strong>) wurde eine Änderung der E-Mail-Adresse auf diese Adresse angefordert. Falls du das warst, klicke auf den folgenden Button, um die Änderung zu bestätigen:</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${confirmLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">E-Mail-Adresse bestätigen</a>
        </p>

        <p style="font-size: 12px; color: #666;">Der Link ist eine Stunde gültig. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${confirmLink}</p>
        <p style="font-size: 12px; color: #666;">Falls du das nicht warst, kannst du diese E-Mail ignorieren - deine E-Mail-Adresse bleibt unverändert.</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der E-Mail-Änderungs-Bestätigung an ${user.pendingEmail}:`, error)
    return false
  }
}

/**
 * Versendet den Bestätigungslink für eine E-Mail-Änderung eines Nutzer-Kontos (GuestUser,
 * siehe requestGuestEmailChange in app/mein-konto/actions.ts) - gleiches Prinzip wie
 * sendEmailChangeConfirmation, nur für das andere Login-System.
 */
export async function sendGuestEmailChangeConfirmation(guestUser: GuestUser) {
  const confirmLink = `${baseUrl()}/mein-konto/confirm-email?token=${guestUser.emailChangeToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: guestUser.pendingEmail!,
    subject: 'Neue E-Mail-Adresse bestätigen',
    text: `Hallo ${guestUser.name},\n\nfür dein Konto (aktuell ${guestUser.email}) wurde eine Änderung der E-Mail-Adresse auf diese Adresse angefordert. Falls du das warst, klicke auf den folgenden Link, um die Änderung zu bestätigen:\n\n${confirmLink}\n\nDer Link ist eine Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren - deine E-Mail-Adresse bleibt unverändert.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Neue E-Mail-Adresse bestätigen</h2>
        <p>Hallo ${guestUser.name}, für dein Konto (aktuell <strong>${guestUser.email}</strong>) wurde eine Änderung der E-Mail-Adresse auf diese Adresse angefordert. Falls du das warst, klicke auf den folgenden Button, um die Änderung zu bestätigen:</p>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${confirmLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">E-Mail-Adresse bestätigen</a>
        </p>

        <p style="font-size: 12px; color: #666;">Der Link ist eine Stunde gültig. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${confirmLink}</p>
        <p style="font-size: 12px; color: #666;">Falls du das nicht warst, kannst du diese E-Mail ignorieren - deine E-Mail-Adresse bleibt unverändert.</p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der E-Mail-Änderungs-Bestätigung an ${guestUser.pendingEmail}:`, error)
    return false
  }
}

/**
 * Versendet eine E-Mail, wenn der Gast initial auf der Warteliste gelandet ist.
 */
export async function sendWaitlistEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const personalLink = personalEventLink(event, participant)

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject: `Du stehst auf der Warteliste für ${event.title} ⏳`,
    text: `Hallo ${participant.name},\n\ndas Event "${event.title}" ist aktuell leider ausgebucht. Du wurdest auf die Warteliste gesetzt.\n\nSobald ein Platz für dich frei wird, rücken wir dich automatisch nach und sagen dir per Mail Bescheid!\n\nHier ist dein persönlicher Link (z.B. falls du deine Wartelisten-Position stornieren möchtest):\n${personalLink}${seriesHintText(event, participant)}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Du bist auf der Warteliste! ⏳</h2>
        <p>Hallo ${participant.name},</p>
        <p>Das Event <strong>${event.title}</strong> ist aktuell leider ausgebucht, aber wir haben deine Anmeldung notiert.</p>
        <p>Sobald jemand abspringt und ein Platz frei wird, rücken wir dich automatisch nach und benachrichtigen dich sofort per E-Mail!</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${personalLink}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Zur Event-Seite</a>
        </p>
        ${seriesHintHtml(event, participant)}
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Wartelisten-Mail an ${participant.email}:`, error)
    return false
  }
}

/**
 * Versendet eine E-Mail, wenn ein Gast von der Warteliste auf einen festen Platz nachrückt.
 */
export async function sendWaitlistPromotedEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const personalLink = personalEventLink(event, participant)

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject: `Gute Nachrichten: Du bist nachgerückt! 🎉 (${event.title})`,
    text: `Hallo ${participant.name},\n\nes ist ein Platz frei geworden und du bist von der Warteliste für "${event.title}" auf einen festen Platz nachgerückt! Deine Teilnahme ist nun verbindlich bestätigt.\n\nHier kannst du deine Anmeldung verwalten:\n${personalLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Du bist dabei, ${participant.name}! 🥳</h2>
        <p>Gute Nachrichten: Es ist ein Platz frei geworden und du bist von der Warteliste für <strong>${event.title}</strong> nachgerückt!</p>
        <p>Deine Teilnahme ist damit nun fest eingebucht.</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${personalLink}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Zur Event-Seite</a>
        </p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Nachrücker-Mail an ${participant.email}:`, error)
    return false
  }
}

/**
 * Versendet eine Änderungs-Mail an einen bereits zugesagten Gast, wenn ein Admin/Creator
 * dringende Termin-Details (Titel/Datum/Dauer/Ort/Beschreibung, siehe diffEventFields in
 * app/admin/actions.ts) nachträglich ändert und dabei bewusst "Teilnehmende benachrichtigen"
 * angehakt hat. Hängt bei einer Zusage die aktualisierte .ics-Datei an (gleiche UID, höhere
 * SEQUENCE als zuvor - siehe buildIcsAttachment), damit ein bereits gespeicherter
 * Kalender-Eintrag beim Öffnen aktualisiert statt dupliziert wird.
 */
export async function sendEventUpdatedEmail(
  participant: Participant,
  rsvp: Rsvp,
  event: EventWithSeries,
  changes: { label: string; detail: string }[]
) {
  const personalLink = personalEventLink(event, participant)
  const icsAttachment = buildIcsAttachment(event, participant)

  const changesText = changes.map(c => `- ${c.label}: ${c.detail}`).join('\n')
  const changesHtml = changes.map(c => `<li><strong>${c.label}:</strong> ${c.detail}</li>`).join('')
  const icsHint = icsAttachment
    ? ' Im Anhang findest du eine aktualisierte Kalenderdatei (.ics) - beim Öffnen kannst du deinen bestehenden Kalendereintrag aktualisieren, statt einen doppelten Eintrag anzulegen.'
    : ''

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: participant.email!,
    subject: `Wichtige Änderung: ${event.title}`,
    text: `Hallo ${participant.name},

für "${event.title}", zu dem du zugesagt hast, gab es eine kurzfristige Änderung:

${changesText}

Bitte beachte das bei deiner Planung.${icsHint}

Deine Antwort bearbeiten: ${personalLink}${seriesHintText(event, participant)}

Viele Grüße,
Dein Event-Team`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Wichtige Änderung an "${event.title}" ⚠️</h2>
        <p>Hallo ${participant.name}, für den Termin, zu dem du zugesagt hast, gab es eine kurzfristige Änderung:</p>
        <ul>${changesHtml}</ul>
        <p>Bitte beachte das bei deiner Planung.${icsHint}</p>
        <p><a href="${personalLink}" style="display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px;">Antwort bearbeiten</a></p>
        ${seriesHintHtml(event, participant)}
      </div>
    `,
    attachments: icsAttachment ? [icsAttachment] : [],

    // Zwingt Mail-Server, den korrekten technischen Absender zu akzeptieren
    envelope: {
      from: process.env.SMTP_USER,
      to: participant.email!
    }
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Änderungs-Mail an ${participant.email}:`, error)
    return false
  }
}
