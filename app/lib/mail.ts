// app/lib/mail.ts
import nodemailer from 'nodemailer'
import { createEvent, DateArray } from 'ics'
import { Event, Rsvp } from '@prisma/client'

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

/**
 * Generiert die Kalenderdatei und verschickt eine Bestätigungs-E-Mail an den Gast.
 */
export async function sendConfirmationEmail(rsvp: Rsvp, event: Event) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const personalLink = `${baseUrl}/${event.slug}?token=${rsvp.editToken}`

  let icsAttachment = null

  // Wenn der Gast zusagt, generieren wir die .ics-Datei für den Anhang
  if (rsvp.isAttending) {
    const date = new Date(event.date)
    const eventDate: DateArray = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes()
    ]

    const fullDescription = `${event.description || ''}\n\nAntwort nachträglich bearbeiten: ${personalLink}`

    const { error, value } = createEvent({
      title: event.title,
      description: fullDescription,
      location: event.location || '',
      start: eventDate,
      duration: { hours: event.duration },
      startInputType: 'utc',
      startOutputType: 'utc'
    })

    if (!error && value) {
      icsAttachment = {
        filename: `${event.slug}.ics`,
        content: value,
        contentType: 'text/calendar'
      }
    }
  }

  // Betreff und Text je nach Zusage oder Absage anpassen
  const subject = rsvp.isAttending 
    ? `Zusage bestätigt: ${event.title}` 
    : `Absage bestätigt: ${event.title}`

  const text = `Hallo ${rsvp.name},

vielen Dank für deine Rückmeldung zum Event "${event.title}".

${rsvp.isAttending 
  ? 'Wir freuen uns sehr, dass du dabei bist! Im Anhang findest du eine Kalenderdatei (.ics), damit du dir den Termin direkt abspeichern kannst.' 
  : 'Schade, dass du nicht dabei sein kannst. Falls sich deine Pläne doch noch ändern sollten, kannst du deine Antwort jederzeit anpassen.'}

Du kannst deine Antwort und alle optionalen Angaben jederzeit über diesen persönlichen Link bearbeiten:
${personalLink}

Viele Grüße,
Dein Event-Team`

  // E-Mail abschicken
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: rsvp.email!, 
    subject,
    text,
    attachments: icsAttachment ? [icsAttachment] : undefined,
    
    // Zwingt Mail-Server, den korrekten technischen Absender zu akzeptieren
    envelope: {
      from: process.env.SMTP_USER,
      to: rsvp.email!
    }
  })
}

/**
 * Versendet eine Erinnerungs-E-Mail an einen bestimmten Gast.
 * Akzeptiert eine optionale, benutzerdefinierte Nachricht des Gastgebers.
 */
export async function sendReminderEmail(
  event: any,
  rsvp: any,
  customMessage: string
) {
  // BASE_URL aus .env auslesen für korrekte Links
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const personalLink = `${baseUrl}/${event.slug}?token=${rsvp.editToken}`

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
    to: rsvp.email,
    subject: `Erinnerung: ${event.title} steht bald an!`,
    text: `Hallo ${rsvp.name},\n\nwir freuen uns, dass du bei "${event.title}" dabei bist!\n\nWann: ${formattedDate} Uhr\nWo: ${event.location || 'Wird noch bekannt gegeben'}\n\n${customMessage ? 'Nachricht des Gastgebers:\n' + customMessage + '\n\n' : ''}Deine Antworten bearbeiten: ${personalLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Wir freuen uns auf dich, ${rsvp.name}! 🎉</h2>
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
    console.error(`Fehler beim Senden der Erinnerung an ${rsvp.email}:`, error)
    return false
  }
}

/**
 * Versendet eine Verifizierungs-E-Mail (Double-Opt-In), wenn requireVerification aktiv ist.
 */
export async function sendVerificationEmail(
  rsvp: any,
  event: any
) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  // Der Bestätigungs-Link leitet auf eine neue Route, die wir gleich noch bauen
  const verifyLink = `${baseUrl}/verify?token=${rsvp.verifyToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: rsvp.email,
    subject: `Bitte bestätige deine Anmeldung für ${event.title}`,
    text: `Hallo ${rsvp.name},\n\nbitte klicke auf den folgenden Link, um deine E-Mail-Adresse zu bestätigen und deine Anmeldung für "${event.title}" abzuschließen:\n\n${verifyLink}\n\nErst nach der Bestätigung wird deine Anmeldung gültig.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Fast geschafft, ${rsvp.name}! ✉️</h2>
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
    console.error(`Fehler beim Senden der Verifizierungs-Mail an ${rsvp.email}:`, error)
    return false
  }
}

/**
 * Versendet eine E-Mail, wenn der Gast initial auf der Warteliste gelandet ist.
 */
export async function sendWaitlistEmail(rsvp: any, event: any) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const personalLink = `${baseUrl}/${event.slug}?token=${rsvp.editToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: rsvp.email,
    subject: `Du stehst auf der Warteliste für ${event.title} ⏳`,
    text: `Hallo ${rsvp.name},\n\ndas Event "${event.title}" ist aktuell leider ausgebucht. Du wurdest auf die Warteliste gesetzt.\n\nSobald ein Platz für dich frei wird, rücken wir dich automatisch nach und sagen dir per Mail Bescheid!\n\nHier ist dein persönlicher Link (z.B. falls du deine Wartelisten-Position stornieren möchtest):\n${personalLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Du bist auf der Warteliste! ⏳</h2>
        <p>Hallo ${rsvp.name},</p>
        <p>Das Event <strong>${event.title}</strong> ist aktuell leider ausgebucht, aber wir haben deine Anmeldung notiert.</p>
        <p>Sobald jemand abspringt und ein Platz frei wird, rücken wir dich automatisch nach und benachrichtigen dich sofort per E-Mail!</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${personalLink}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Zur Event-Seite</a>
        </p>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der Wartelisten-Mail an ${rsvp.email}:`, error)
    return false
  }
}

/**
 * Versendet eine E-Mail, wenn ein Gast von der Warteliste auf einen festen Platz nachrückt.
 */
export async function sendWaitlistPromotedEmail(rsvp: any, event: any) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const personalLink = `${baseUrl}/${event.slug}?token=${rsvp.editToken}`

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: rsvp.email,
    subject: `Gute Nachrichten: Du bist nachgerückt! 🎉 (${event.title})`,
    text: `Hallo ${rsvp.name},\n\nes ist ein Platz frei geworden und du bist von der Warteliste für "${event.title}" auf einen festen Platz nachgerückt! Deine Teilnahme ist nun verbindlich bestätigt.\n\nHier kannst du deine Anmeldung verwalten:\n${personalLink}`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Du bist dabei, ${rsvp.name}! 🥳</h2>
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
    console.error(`Fehler beim Senden der Nachrücker-Mail an ${rsvp.email}:`, error)
    return false
  }
}