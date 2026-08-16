// app/api/cron/reminders/route.ts
import { PrismaClient } from '@prisma/client'
import { NextResponse } from 'next/server'
import { sendReminderEmail } from '../../../lib/mail'

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
        where: {
          isAttending: true,
          email: { not: null }
        }
      }
    }
  })

  let sentCount = 0;

  for (const event of events) {
    // 3. Trigger-Datum berechnen (Event-Datum minus X Tage Vorlauf)
    const triggerDate = new Date(event.date)
    triggerDate.setDate(triggerDate.getDate() - event.reminderDays)

    // 4. Wenn "jetzt" das Trigger-Datum erreicht oder überschritten hat -> Mails senden!
    if (now >= triggerDate) {
      const validRsvps = event.rsvps.filter(rsvp => rsvp.email && rsvp.email.trim() !== "")
      
      if (validRsvps.length > 0) {
        // Bei der automatischen Erinnerung lassen wir den manuellen customMessage-Text leer
        const emailPromises = validRsvps.map(rsvp => 
          sendReminderEmail(event, rsvp, "") 
        )
        await Promise.allSettled(emailPromises)
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