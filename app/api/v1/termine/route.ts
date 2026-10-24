// app/api/v1/termine/route.ts
import { PrismaClient } from '@prisma/client'
import { getGuestUserFromApiToken, apiError } from '../../../lib/api-auth'
import { companionsOf, menuOf } from '../../../lib/persons'
import { courseOptions } from '../../../lib/menu'

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
          events: { where: { date: { gte: new Date() } }, orderBy: { date: 'asc' }, include: { menuCourses: { orderBy: { position: 'asc' } } } }
        }
      }
    }
  })

  const participants = await prisma.participant.findMany({
    where: { guestUserId: guestUser.id },
    include: { rsvps: { include: { persons: { orderBy: { position: 'asc' }, include: { menuChoices: true } } } } }
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
          // null, solange das Datum per Terminabstimmung noch offen ist (Event.datePending).
          date: event.datePending ? null : event.date.toISOString(),
          datePending: event.datePending,
          durationHours: event.duration,
          location: event.location,
          description: event.description,
          maxCapacity: event.maxCapacity,
          maxCompanions: event.maxCompanions,
          // Antwortfrist (Ende des Tages), danach antwortet POST mit 400
          rsvpDeadline: event.rsvpDeadline ? event.rsvpDeadline.toISOString() : null,
          // Menü: Gänge mit Optionen, beim Antworten als menu bzw. companions[].menu {Gang-ID: Option}
          menuCourses: event.menuCourses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) })),
          url: `/reihe/${m.series.slug}/${event.slug}`,
          // Verknüpfte Abstimmung (Event.pollUrl); den persönlichen Link gibt GET .../[id]/abstimmung
          poll: event.pollUrl ? { label: event.pollLabel || null } : null,
          myRsvp: rsvp
            ? {
                isAttending: rsvp.isAttending,
                isOnWaitlist: rsvp.isOnWaitlist,
                // Begleitungen (alle Personen außer der eigenen), plusOne/plusOneName als Kurzform von früher
                companions: companionsOf(rsvp.persons),
                // Eigene Menüwahl (Gang-ID -> Option), die der Begleitungen steht in companions[].menu
                menu: rsvp.persons[0] ? menuOf(rsvp.persons[0]) : {},
                plusOne: rsvp.persons.length > 1,
                plusOneName: rsvp.persons[1]?.name ?? null,
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
