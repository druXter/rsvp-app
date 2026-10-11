// app/lib/menu-store.ts
//
// Datenbankseite der Menüwahl (app/lib/menu.ts): Gänge eines Termins lesen, prüfen und speichern.
import { prisma } from './prisma'
import { courseOptions, type MenuCourseForForm, type MenuCourseInput } from './menu'
import { InputError } from './input-error'

/** Die Gänge eines Termins in Reihenfolge, mit Optionen als Liste. */
export async function menuForForm(eventId: string): Promise<MenuCourseForForm[]> {
  const courses = await prisma.menuCourse.findMany({ where: { eventId }, orderBy: { position: 'asc' } })
  return courses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) }))
}

/**
 * Ein Gang oder eine Option, die schon jemand gewählt hat, lässt sich nicht entfernen oder umbenennen - sonst
 * stünde die Wahl ohne Gang da. Vor dem Speichern des Termins aufrufen, damit nichts halb gespeichert wird.
 */
export async function assertMenuChangeable(eventId: string, courses: readonly MenuCourseInput[] | null): Promise<void> {
  if (courses === null) return
  const existing = await prisma.menuCourse.findMany({ where: { eventId }, include: { choices: { select: { option: true } } } })
  for (const course of existing) {
    if (course.choices.length === 0) continue
    const kept = courses.find(c => c.label === course.label)
    if (!kept) throw new InputError(`Menü: Für „${course.label}“ gibt es schon ${course.choices.length} Wahl/Wahlen, der Gang kann nicht entfernt oder umbenannt werden.`)
    const lost = course.choices.find(choice => !kept.options.includes(choice.option))
    if (lost) throw new InputError(`Menü: „${lost.option}“ bei „${course.label}“ wurde schon gewählt und kann nicht entfernt oder umbenannt werden.`)
  }
}

/** Speichert die Gänge per Abgleich nach Bezeichnung (bestehende behalten ihre Wahl). null = unverändert. */
export async function saveMenu(eventId: string, courses: MenuCourseInput[] | null): Promise<void> {
  if (courses === null) return
  await assertMenuChangeable(eventId, courses)
  const existing = await prisma.menuCourse.findMany({ where: { eventId } })
  const byLabel = new Map(existing.map(c => [c.label, c]))
  const keep = new Set(courses.map(c => c.label))
  await prisma.$transaction(async tx => {
    await tx.menuCourse.deleteMany({ where: { eventId, label: { notIn: [...keep] } } })
    for (const [position, course] of courses.entries()) {
      const data = { options: JSON.stringify(course.options), position }
      const current = byLabel.get(course.label)
      if (current) await tx.menuCourse.update({ where: { id: current.id }, data })
      else await tx.menuCourse.create({ data: { eventId, label: course.label, ...data } })
    }
  })
}
