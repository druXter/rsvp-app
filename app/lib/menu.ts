// app/lib/menu.ts
//
// Menüwahl pro Person (Idee L3 der Suite, docs/KONZEPT-EINLADUNGEN.md): Die Verwaltung legt pro Termin Gänge mit
// Optionen an (Textfeld, eine Zeile pro Gang: "Hauptgang: Fisch; Fleisch; Vegetarisch"), jede zusagende Person
// außer Kleinkindern wählt pro Gang eine Option. Reine Funktionen ohne Datenbank, auch im Browser nutzbar;
// Speichern und Prüfen gegen bestehende Wahl in app/lib/menu-store.ts.
import { InputError } from './input-error'

export const MENU_LIMITS = { courses: 8, options: 12, label: 60 }

export type MenuCourseInput = { label: string; options: string[] }
export type MenuCourseForForm = MenuCourseInput & { id: string }
/** Wahl einer Person: Gang-ID -> Option (Text) */
export type MenuSelection = Record<string, string>

/**
 * Liest das Textfeld der Verwaltung. Leere Zeilen zählen nicht. Wirft mit einer Meldung fürs Formular: ohne
 * Doppelpunkt, ohne Optionen, doppelte Gänge oder Optionen, zu lang, zu viele.
 */
export function parseMenu(text: string): MenuCourseInput[] {
  const courses: MenuCourseInput[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue
    const colon = raw.indexOf(':')
    if (colon < 0) throw new InputError(`Menü: In „${raw.trim().slice(0, 30)}“ fehlt der Doppelpunkt (Gang: Option; Option).`)
    const label = raw.slice(0, colon).trim()
    if (!label) throw new InputError('Menü: Jede Zeile braucht vorne den Namen des Gangs.')
    if (label.length > MENU_LIMITS.label) throw new InputError(`Menü: „${label.slice(0, 30)}…“ ist zu lang (höchstens ${MENU_LIMITS.label} Zeichen).`)
    if (courses.some(c => c.label === label)) throw new InputError(`Menü: Der Gang „${label}“ steht doppelt in der Liste.`)
    const options = raw.slice(colon + 1).split(';').map(o => o.trim()).filter(Boolean)
    if (options.length === 0) throw new InputError(`Menü: „${label}“ braucht mindestens eine Option.`)
    if (options.length > MENU_LIMITS.options) throw new InputError(`Menü: „${label}“ hat zu viele Optionen (höchstens ${MENU_LIMITS.options}).`)
    for (const option of options) {
      if (option.length > MENU_LIMITS.label) throw new InputError(`Menü: Die Option „${option.slice(0, 30)}…“ ist zu lang (höchstens ${MENU_LIMITS.label} Zeichen).`)
      if (options.filter(o => o === option).length > 1) throw new InputError(`Menü: „${option}“ steht bei „${label}“ doppelt.`)
    }
    courses.push({ label, options })
  }
  if (courses.length > MENU_LIMITS.courses) throw new InputError(`Menü: höchstens ${MENU_LIMITS.courses} Gänge.`)
  return courses
}

/** Gegenstück zu parseMenu fürs Bearbeiten-Formular. */
export function formatMenu(courses: readonly MenuCourseInput[]): string {
  return courses.map(c => `${c.label}: ${c.options.join('; ')}`).join('\n')
}

/** Liest das Feld nur, wenn das Formular es hat - sonst bleibt das Menü unangetastet (null). */
export function readMenu(formData: FormData): MenuCourseInput[] | null {
  return formData.has('menu') ? parseMenu(formData.get('menu') as string || '') : null
}

/** Optionen eines gespeicherten Gangs (MenuCourse.options ist ein JSON-Array). */
export function courseOptions(options: string): string[] {
  try {
    const parsed = JSON.parse(options)
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : []
  } catch {
    return []
  }
}

/**
 * Wahl aus Formularfeldern `<prefix><courseId>` (z. B. menu_<id> für die anmeldende Person). undefined, wenn das
 * Formular keine Menüfelder hat (Markierungsfeld menuShown) - dann bleibt die bisherige Wahl.
 */
export function readMenuSelection(formData: FormData, prefix: string): MenuSelection | undefined {
  if (!formData.has('menuShown')) return undefined
  const selection: MenuSelection = {}
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix) && typeof value === 'string' && value) {
      const courseId = key.slice(prefix.length)
      if (/^[a-z0-9]{1,40}$/i.test(courseId)) selection[courseId] = value.slice(0, MENU_LIMITS.label)
    }
  }
  return selection
}

/** Nur Gänge und Optionen, die es gibt. Unbekanntes fällt weg (anderer Termin, entfernter Gang). */
export function validSelection(courses: readonly MenuCourseForForm[], selection: MenuSelection | null | undefined): MenuSelection {
  const result: MenuSelection = {}
  for (const course of courses) {
    const option = selection?.[course.id]
    if (option && course.options.includes(option)) result[course.id] = option
  }
  return result
}

/** Hat die Wahl für jeden Gang eine gültige Option? */
export function isCompleteSelection(courses: readonly MenuCourseForForm[], selection: MenuSelection | null | undefined): boolean {
  return courses.every(course => !!selection?.[course.id] && course.options.includes(selection[course.id]))
}

/** "Hauptgang: Fisch, Dessert: Eis" - für Verwaltung und Mails. */
export function describeSelection(courses: readonly { id: string; label: string }[], selection: MenuSelection | null | undefined): string {
  return courses.filter(c => selection?.[c.id]).map(c => `${c.label}: ${selection![c.id]}`).join(', ')
}
