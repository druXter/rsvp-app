// app/api/cron/reminders/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { sendReminderEmail } from '../../../lib/mail'
import { sendReminderPush } from '../../../lib/push'

const prisma = new PrismaClient()

/**
 * Automatischer Cron-Endpoint für Uptime Kuma.
 * Prüft fällige Events und versendet automatische Erinnerungen.
 */
export async function GET(request: Request) {
  // 1. Sicherheitscheck: Verhindert, dass Fremde den Endpunkt aufrufen und Mails auslösen
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  
  if (secret !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()

  // 2. Alle zukünftigen Events laden, bei denen die Automatik AN ist und noch NICHT gesendet wurde
  const events = await prisma.event.findMany({
    where: {
      autoReminder: true,
      reminderSent: false,
      date: { gte: now } // Das Event darf noch nicht vorbei sein
    },
    include: {
      rsvps: {
        where: { isAttending: true },
        include: { participant: true }
      },
      series: true
    }
  })

  let sentCount = 0;

  for (const event of events) {
    // 3. Trigger-Datum berechnen (Event-Datum minus X Tage Vorlauf)
    const triggerDate = new Date(event.date)
    triggerDate.setDate(triggerDate.getDate() - event.reminderDays)

    // 4. Wenn "jetzt" das Trigger-Datum erreicht oder überschritten hat -> Mails senden!
    if (now >= triggerDate) {
      const validRsvps = event.rsvps.filter(rsvp => rsvp.participant.email && rsvp.participant.email.trim() !== "")

      // E-Mail und Push unabhängig voneinander verschicken: Push hängt an der
      // Participant-Identität (siehe sendPushToParticipant), nicht an einer hinterlegten
      // E-Mail - jemand kann also auch ganz ohne E-Mail-Adresse Push-Erinnerungen bekommen.
      if (validRsvps.length > 0) {
        // Bei der automatischen Erinnerung lassen wir den manuellen customMessage-Text leer
        const emailPromises = validRsvps.map(rsvp =>
          sendReminderEmail(event, rsvp.participant, "")
        )
        await Promise.allSettled(emailPromises)
      }
      if (event.rsvps.length > 0) {
        const pushPromises = event.rsvps.map(rsvp => sendReminderPush(event, rsvp.participant))
        await Promise.allSettled(pushPromises)
      }

      // 5. In der Datenbank markieren, dass für dieses Event alles erledigt ist 
      // (geschieht auch, wenn niemand auf der Liste stand, um Dauer-Schleifen zu verhindern)
      await prisma.event.update({
        where: { id: event.id },
        data: { reminderSent: true }
      })
      
      sentCount++;
    }
  }

  return NextResponse.json({ success: true, processedEvents: sentCount })
}