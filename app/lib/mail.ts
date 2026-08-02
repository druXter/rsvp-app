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