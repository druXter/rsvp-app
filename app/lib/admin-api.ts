// app/lib/admin-api.ts
//
// Lesende Verwaltungs-API (app/api/v1/verwaltung/) für Verwaltungskonten mit API-Token (UserApiToken, siehe
// app/lib/api-auth.ts). Sie gibt genau das heraus, was das Konto in der Oberfläche sehen darf: Konten mit
// Admin-Rolle alles, sonst eigene Events/Reihen und per ResourceAccess freigegebene (wie das Dashboard
// app/admin/page.tsx). Die Rechte werden bei jeder Anfrage neu geprüft - eine entzogene Freigabe wirkt sofort.
// Schreiben geht über diese API nicht.
import type { Prisma, User } from '@prisma/client'
import { prisma } from './prisma'
import { hasEventModeratorOrAbove, isOwnerOrAdmin } from './permissions'
import type { KitchenReport } from './kitchen'

/** Bedingung für alle Events (Einzel-Events und Termine), auf die das Konto Zugriff hat. */
export async function accessibleEventsWhere(user: User): Promise<Prisma.EventWhereInput> {
  if (user.role === 'ADMIN') return {}
  const access = await prisma.resourceAccess.findMany({ where: { userId: user.id }, select: { eventId: true, seriesId: true } })
  const eventIds = access.flatMap(a => (a.eventId ? [a.eventId] : []))
  const seriesIds = access.flatMap(a => (a.seriesId ? [a.seriesId] : []))
  // Termine einer Reihe tragen den Owner der Reihe (addTerminToSeries), ownerId deckt eigene Reihen also mit ab.
  return { OR: [{ ownerId: user.id }, { id: { in: eventIds } }, { seriesId: { in: seriesIds } }] }
}

/** Ein Event samt Rechten, oder null - ob es fehlt oder nur nicht zugänglich ist, verrät die API nicht (404). */
export async function loadApiEvent(user: User, eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: { select: { id: true, slug: true, title: true } } } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return null
  return { event, isOwner: isOwnerOrAdmin(user, event.ownerId) }
}

/**
 * Küchenübersicht für die API: Zählungen wie im Reiter "Küche", dazu pro Person Name und Menüwahl (mit Gang-
 * Namen statt IDs) und der Tisch aus Seating. Bewusst OHNE Essenswunsch und Allergien pro Person - das sind
 * Gesundheitsdaten (Art. 9 DSGVO), die nicht in fremde Software wandern sollen; die API nennt nur, wie viele
 * Personen Allergien angegeben haben, die Einzelheiten stehen in der Verwaltung.
 */
export function kitchenForApi(report: KitchenReport) {
  const courseLabel = new Map(report.courses.map(c => [c.id, c.label]))
  return {
    totals: { adults: report.totals.ADULT, children: report.totals.CHILD, infants: report.totals.INFANT },
    courses: report.courses.map(c => ({
      id: c.id,
      label: c.label,
      counts: c.counts.map(x => ({ option: x.option, adults: x.adults, children: x.children, total: x.adults + x.children })),
      missing: c.missing
    })),
    diets: report.diets,
    drinks: report.drinks,
    personsWithAllergies: report.persons.filter(p => p.allergies).length,
    persons: report.persons.map(p => ({
      answer: p.answer,
      name: p.name,
      ageGroup: p.ageGroup,
      menu: Object.entries(p.menu).filter(([id]) => courseLabel.has(id)).map(([id, option]) => ({ courseId: id, course: courseLabel.get(id)!, option })),
      table: p.table,
      seat: p.seat
    }))
  }
}
