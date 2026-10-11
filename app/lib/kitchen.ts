// app/lib/kitchen.ts
//
// Küchenübersicht (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 4): Wer mit festem Platz kommt, was jede Person
// gewählt hat, Essen und Allergien - pro Gang gezählt nach Erwachsenen und Kindern, mit Seating auch pro Tisch.
// Für die Seite /admin/events/[id]/kueche und die Personen-CSV. buildKitchenReport ist rein, loadKitchenReport liest
// die Datenbank.
import { prisma } from './prisma'
import { personsOf, type AgeGroup } from './persons'
import { courseOptions, type MenuCourseForForm, type MenuSelection } from './menu'
import { placesOfPersons } from './seating'

export type KitchenPerson = {
  /** Name der Antwort (anmeldende Person bzw. Haushalt) */
  answer: string
  name: string
  ageGroup: AgeGroup
  dietaryOption: string | null
  allergies: string | null
  menu: MenuSelection
  /** Alkohol ja/nein (nur Erwachsene) */
  drinksAlcohol: boolean | null
  /** Tisch der Person aus Seating, wenn bekannt */
  table: string | null
  /** Platz aus Seating: der eigene ("Tisch 7, Platz 3"), sonst der der Antwort ("Tisch 7, Plätze 3, 4") */
  seat: string | null
}

/** Ein Tisch der Küchenliste: Personen in Sitzreihenfolge und die Wahl pro Gang (Erwachsene und Kinder zusammen). */
export type KitchenTable = {
  /** null: Personen ohne bekannten Tisch */
  table: string | null
  persons: KitchenPerson[]
  totals: Record<AgeGroup, number>
  courses: { id: string; label: string; counts: { option: string; count: number }[]; missing: number }[]
}

export type KitchenReport = {
  courses: (MenuCourseForForm & { counts: { option: string; adults: number; children: number }[]; missing: number })[]
  persons: KitchenPerson[]
  totals: Record<AgeGroup, number>
  diets: { label: string; count: number }[]
  /** Erwachsene mit Alkohol / nur alkoholfrei (ohne Angabe zählt nicht) */
  drinks: { alcohol: number; alcoholFree: number }
  /** Pro Tisch - leer, solange Seating für niemanden einen Tisch gemeldet hat */
  tables: KitchenTable[]
}

type KitchenRsvp = {
  isAttending: boolean
  isOnWaitlist: boolean
  drinksAlcohol?: boolean | null
  seatingLabel: string | null
  seatingPersons?: string | null
  participant: { name: string; dietaryOption: string | null; allergies: string | null }
  persons?: { position: number; name: string | null; ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null; drinksAlcohol?: boolean | null; menuChoices?: { courseId: string; option: string }[] }[]
}

export function buildKitchenReport(courses: readonly MenuCourseForForm[], rsvps: readonly KitchenRsvp[]): KitchenReport {
  const persons: KitchenPerson[] = rsvps
    .filter(r => r.isAttending && !r.isOnWaitlist)
    .flatMap(r => {
      const all = personsOf(r, r.participant)
      const places = placesOfPersons(all, r.seatingPersons ?? null)
      return all
        .map((p, i) => ({ p, place: places[i] }))
        .filter(({ p }) => p.isAttending)
        .map(({ p, place }) => ({
          answer: r.participant.name, name: p.name || 'Begleitung', ageGroup: p.ageGroup, dietaryOption: p.dietaryOption, allergies: p.allergies,
          menu: p.menu, drinksAlcohol: p.drinksAlcohol, table: place.table, seat: place.seat ?? r.seatingLabel
        }))
    })
  // Nach Tisch, dann Platz (ohne zuletzt), dann Antwort - die Reihenfolge innerhalb einer Antwort bleibt
  const natural = (a: string | null, b: string | null) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? '').localeCompare(b ?? '', 'de', { numeric: true })
  const order = persons.map((p, i) => ({ p, i }))
  order.sort((a, b) => natural(a.p.table, b.p.table) || natural(a.p.seat, b.p.seat) || a.p.answer.localeCompare(b.p.answer, 'de') || a.i - b.i)
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
    diets: [...dietCounts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    drinks: { alcohol: sorted.filter(p => p.drinksAlcohol === true).length, alcoholFree: sorted.filter(p => p.drinksAlcohol === false).length },
    tables: sorted.some(p => p.table) ? groupByTable(courses, sorted) : []
  }
}

/** Küchenliste pro Tisch: Tische in natürlicher Reihenfolge ("Tisch 2" vor "Tisch 10"), Personen ohne Tisch zuletzt. */
function groupByTable(courses: readonly MenuCourseForForm[], persons: readonly KitchenPerson[]): KitchenTable[] {
  const groups = new Map<string | null, KitchenPerson[]>()
  for (const p of persons) groups.set(p.table, [...(groups.get(p.table) ?? []), p])
  return [...groups].map(([table, members]) => {
    const eating = members.filter(p => p.ageGroup !== 'INFANT')
    return {
      table,
      persons: members,
      totals: {
        ADULT: members.filter(p => p.ageGroup === 'ADULT').length,
        CHILD: members.filter(p => p.ageGroup === 'CHILD').length,
        INFANT: members.filter(p => p.ageGroup === 'INFANT').length
      },
      courses: courses.map(course => ({
        id: course.id,
        label: course.label,
        counts: course.options.map(option => ({ option, count: eating.filter(p => p.menu[course.id] === option).length })).filter(c => c.count > 0),
        missing: eating.filter(p => !p.menu[course.id] || !course.options.includes(p.menu[course.id])).length
      }))
    }
  })
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
