// app/api/v1/verwaltung/termine/route.ts
import { apiError, getUserFromApiToken } from '../../../../lib/api-auth'
import { accessibleEventsWhere } from '../../../../lib/admin-api'
import { courseOptions } from '../../../../lib/menu'
import { isOwnerOrAdmin } from '../../../../lib/permissions'
import { summarizeEvent } from '../../../../lib/event-summary'
import { prisma } from '../../../../lib/prisma'

const RECENT_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Alle Termine (Einzel-Events und Termine von Reihen), auf die das Konto Zugriff hat - mit den Summen der
 * Antworten und den Menü-Gängen. Standardmäßig ab zwei Tagen vor jetzt (so bleibt ein gerade vergangener Termin
 * noch abrufbar), mit `?alle=1` alle. Keine Namen: die stehen in der Küchenübersicht pro Termin.
 */
export async function GET(request: Request) {
  const user = await getUserFromApiToken(request)
  if (!user) return apiError(401, 'Ungültiger oder fehlender API-Token')

  const all = new URL(request.url).searchParams.get('alle') === '1'
  const events = await prisma.event.findMany({
    where: { AND: [await accessibleEventsWhere(user), all ? {} : { date: { gte: new Date(Date.now() - RECENT_MS) } }] },
    orderBy: { date: 'asc' },
    include: {
      series: { select: { id: true, slug: true, title: true } },
      menuCourses: { orderBy: { position: 'asc' } },
      rsvps: {
        select: {
          isAttending: true, isMaybe: true, isOnWaitlist: true, hasAttended: true, amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true,
          persons: { select: { isAttending: true, ageGroup: true } }
        }
      }
    }
  })

  return Response.json({
    termine: events.map(event => {
      const summary = summarizeEvent(event.rsvps)
      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        date: event.date.toISOString(),
        datePending: event.datePending,
        location: event.location,
        series: event.series,
        isOwner: isOwnerOrAdmin(user, event.ownerId),
        responses: { yes: summary.confirmed, no: summary.declined, maybe: summary.maybe, waitlist: summary.waitlist, persons: summary.attendees },
        menu: event.menuCourses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) }))
      }
    })
  }, { headers: { 'cache-control': 'no-store' } })
}
