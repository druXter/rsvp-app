// app/api/v1/termine/route.ts
import { PrismaClient } from '@prisma/client'
import { getGuestUserFromApiToken, apiError } from '../../../lib/api-auth'

const prisma = new PrismaClient()

/**
 * Alle kommenden Termine der Reihen, denen das Konto angehört - jeweils mit der eigenen
 * Antwort, sofern schon eine abgegeben wurde. Bewusst auf die eigenen Mitgliedschaften
 * begrenzt: die API gibt nie Daten anderer Gäste heraus, also weder eine Gästeliste noch
 * fremde Namen. Eine Reihen-PIN wird hier nicht geprüft, weil sie die öffentlichen Seiten
 * vor Fremden schützt - wer bereits Mitglied der Reihe ist, hat sie längst passiert.
 */
export async function GET(request: Request) {
  const guestUser = await getGuestUserFromApiToken(request)
  if (!guestUser) return apiError(401, 'Ungültiger oder fehlender API-Token')

  const memberships = await prisma.guestUserSeries.findMany({
    where: { guestUserId: guestUser.id },
    include: {
      series: {
        include: {
          events: { where: { date: { gte: new Date() } }, orderBy: { date: 'asc' } }
        }
      }
    }
  })

  const participants = await prisma.participant.findMany({
    where: { guestUserId: guestUser.id },
    include: { rsvps: true }
  })
  const rsvpByEventId = new Map(
    participants.flatMap(p => p.rsvps.map(r => [r.eventId, r] as const))
  )

  return Response.json({
    series: memberships.map(m => ({
      id: m.series.id,
      slug: m.series.slug,
      title: m.series.title,
      events: m.series.events.map(event => {
        const rsvp = rsvpByEventId.get(event.id)
        return {
          id: event.id,
          slug: event.slug,
          title: event.title,
          date: event.date.toISOString(),
          durationHours: event.duration,
          location: event.location,
          description: event.description,
          maxCapacity: event.maxCapacity,
          url: `/reihe/${m.series.slug}/${event.slug}`,
          myRsvp: rsvp
            ? {
                isAttending: rsvp.isAttending,
                isOnWaitlist: rsvp.isOnWaitlist,
                plusOne: rsvp.plusOne,
                plusOneName: rsvp.plusOneName,
                bringingItem: rsvp.bringingItem,
                drinksAlcohol: rsvp.drinksAlcohol,
                additionalInfo: rsvp.additionalInfo,
                declineReason: rsvp.declineReason,
                customAnswers: rsvp.customAnswers ? JSON.parse(rsvp.customAnswers) : [],
                hasAttended: rsvp.hasAttended
              }
            : null,
          customQuestions: event.formConfig ? (JSON.parse(event.formConfig).customQuestions || []) : []
        }
      })
    }))
  })
}
