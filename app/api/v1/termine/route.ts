// app/api/v1/termine/route.ts
import { prisma } from '../../../lib/prisma'
import { getGuestUserFromApiToken, apiError } from '../../../lib/api-auth'
import { companionsOf, menuOf } from '../../../lib/persons'
import { courseOptions } from '../../../lib/menu'
import { summarizeEvent } from '../../../lib/event-summary'
import { latestMaybeReminder, maybeAvailable } from '../../../lib/maybe'


/**
 * Alle kommenden Termine der Reihen, denen das Konto angehört - jeweils mit der eigenen
 * Antwort, sofern schon eine abgegeben wurde. Bewusst auf die eigenen Mitgliedschaften
 * begrenzt: die API gibt nie Daten anderer Gäste heraus, also weder eine Gästeliste noch
 * fremde Namen. Einzige Ausnahme sind die Summen der Antworten (`responses`), und nur in
 * Reihen mit sichtbarer Gästeliste - dort sehen alle Mitglieder auf der Seite ohnehin mehr
 * (Namen). Gezählt wird wie in der Verwaltung (summarizeEvent). Eine Reihen-PIN wird hier
 * nicht geprüft, weil sie die öffentlichen Seiten vor Fremden schützt - wer bereits Mitglied
 * der Reihe ist, hat sie längst passiert.
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

  // Summen nur für Reihen mit sichtbarer Gästeliste - ohne Namen oder sonstige Angaben anderer Gäste.
  const countedEventIds = memberships.filter(m => m.series.isGuestListVisible).flatMap(m => m.series.events.map(e => e.id))
  const allRsvps = countedEventIds.length
    ? await prisma.rsvp.findMany({
        where: { eventId: { in: countedEventIds } },
        select: {
          eventId: true, isAttending: true, isMaybe: true, isOnWaitlist: true, hasAttended: true,
          amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true,
          persons: { select: { isAttending: true, ageGroup: true } }
        }
      })
    : []
  function responsesOf(eventId: string) {
    const summary = summarizeEvent(allRsvps.filter(r => r.eventId === eventId))
    return { yes: summary.confirmed, no: summary.declined, maybe: summary.maybe, waitlist: summary.waitlist, persons: summary.attendees }
  }

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
          // „Vielleicht“ (app/lib/maybe.ts): ob es gerade wählbar ist und der späteste Erinnerungszeitpunkt (null = offen)
          maybe: maybeAvailable({ ...event, series: m.series })
            ? { latestReminder: latestMaybeReminder(event)?.toISOString() ?? null }
            : null,
          url: `/reihe/${m.series.slug}/${event.slug}`,
          // Verknüpfte Abstimmung (Event.pollUrl); den persönlichen Link gibt GET .../[id]/abstimmung
          poll: event.pollUrl ? { label: event.pollLabel || null } : null,
          // Summen aller Antworten (yes/no/waitlist = Antworten, persons = zusagende Personen mit Begleitungen),
          // null, wenn die Gästeliste der Reihe nicht sichtbar ist
          responses: m.series.isGuestListVisible ? responsesOf(event.id) : null,
          myRsvp: rsvp
            ? {
                isAttending: rsvp.isAttending,
                isOnWaitlist: rsvp.isOnWaitlist,
                // „Vielleicht“ mit Erinnerungszeitpunkt (isAttending ist dann false)
                maybe: rsvp.isMaybe,
                maybeRemindAt: rsvp.maybeRemindAt ? rsvp.maybeRemindAt.toISOString() : null,
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
