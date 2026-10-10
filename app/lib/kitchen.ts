// app/lib/kitchen.ts
//
// Küchenübersicht (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 4): Wer mit festem Platz kommt, was jede Person
// gewählt hat, Essen und Allergien - pro Gang gezählt nach Erwachsenen und Kindern. Für die Seite
// /admin/kueche/[eventId] und die Personen-CSV. buildKitchenReport ist rein, loadKitchenReport liest die Datenbank.
import { prisma } from './prisma'
import { personsOf, type AgeGroup } from './persons'
import { courseOptions, type MenuCourseForForm, type MenuSelection } from './menu'

export type KitchenPerson = {
  /** Name der Antwort (anmeldende Person bzw. Haushalt) */
  answer: string
  name: string
  ageGroup: AgeGroup
  dietaryOption: string | null
  allergies: string | null
  menu: MenuSelection
  /** Platz aus Seating ("Tisch 7, Plätze 3, 4"), pro Antwort */
  seat: string | null
}

export type KitchenReport = {
  courses: (MenuCourseForForm & { counts: { option: string; adults: number; children: number }[]; missing: number })[]
  persons: KitchenPerson[]
  totals: Record<AgeGroup, number>
  diets: { label: string; count: number }[]
}

type KitchenRsvp = {
  isAttending: boolean
  isOnWaitlist: boolean
  seatingLabel: string | null
  participant: { name: string; dietaryOption: string | null; allergies: string | null }
  persons?: { position: number; name: string | null; ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null; menuChoices?: { courseId: string; option: string }[] }[]
}

export function buildKitchenReport(courses: readonly MenuCourseForForm[], rsvps: readonly KitchenRsvp[]): KitchenReport {
  const persons: KitchenPerson[] = rsvps
    .filter(r => r.isAttending && !r.isOnWaitlist)
    .flatMap(r => personsOf(r, r.participant)
      .filter(p => p.isAttending)
      .map(p => ({ answer: r.participant.name, name: p.name || 'Begleitung', ageGroup: p.ageGroup, dietaryOption: p.dietaryOption, allergies: p.allergies, menu: p.menu, seat: r.seatingLabel })))
  // Nach Platz (ohne Platz zuletzt), dann Antwort - die Reihenfolge innerhalb einer Antwort bleibt
  const order = persons.map((p, i) => ({ p, i }))
  order.sort((a, b) => (a.p.seat === null ? 1 : 0) - (b.p.seat === null ? 1 : 0) || (a.p.seat ?? '').localeCompare(b.p.seat ?? '', 'de', { numeric: true }) || a.p.answer.localeCompare(b.p.answer, 'de') || a.i - b.i)
  const sorted = order.map(o => o.p)

  const eating = sorted.filter(p => p.ageGroup !== 'INFANT')
  const dietCounts = new Map<string, number>()
  for (const p of eating) dietCounts.set(p.dietaryOption || 'ohne Angabe', (dietCounts.get(p.dietaryOption || 'ohne Angabe') ?? 0) + 1)

  return {
    courses: courses.map(course => ({
      ...course,
      counts: course.options.map(option => ({
        option,
        adults: eating.filter(p => p.ageGroup === 'ADULT' && p.menu[course.id] === option).length,
        children: eating.filter(p => p.ageGroup === 'CHILD' && p.menu[course.id] === option).length
      })),
      missing: eating.filter(p => !p.menu[course.id] || !course.options.includes(p.menu[course.id])).length
    })),
    persons: sorted,
    totals: {
      ADULT: sorted.filter(p => p.ageGroup === 'ADULT').length,
      CHILD: sorted.filter(p => p.ageGroup === 'CHILD').length,
      INFANT: sorted.filter(p => p.ageGroup === 'INFANT').length
    },
    diets: [...dietCounts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }
}

export async function loadKitchenReport(eventId: string): Promise<KitchenReport> {
  const [courses, rsvps] = await Promise.all([
    prisma.menuCourse.findMany({ where: { eventId }, orderBy: { position: 'asc' } }),
    prisma.rsvp.findMany({
      where: { eventId, isAttending: true, isOnWaitlist: false },
      include: { participant: true, persons: { include: { menuChoices: true } } },
      orderBy: { createdAt: 'asc' }
    })
  ])
  return buildKitchenReport(courses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) })), rsvps)
}
