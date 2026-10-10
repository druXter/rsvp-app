// app/admin/menu-settings-section.tsx
import { formatMenu, type MenuCourseInput } from '../lib/menu'
import { hintClass, inputClass, labelClass } from '../ui/kit'

/**
 * Feld "Menü" der Termin-Einstellungen (app/admin/event-settings-form.tsx): Gänge mit Optionen (app/lib/menu.ts),
 * gelesen von readMenu in app/admin/actions.ts.
 */
export function MenuFields({ courses }: { courses?: MenuCourseInput[] }) {
  return (
    <div>
      <label htmlFor="menu" className={labelClass}>Gänge (Optional)</label>
      <textarea id="menu" name="menu" rows={3} defaultValue={courses ? formatMenu(courses) : ''} className={inputClass} placeholder={'Vorspeise: Suppe; Salat\nHauptgang: Fisch; Fleisch; Vegetarisch\nKinder: Nudeln; Pommes'} />
      <p className={hintClass}>Eine Zeile pro Gang: Name, Doppelpunkt, Optionen mit Semikolon getrennt. Ein Kindermenü ist einfach eine weitere Option. Jede Person mit Zusage (auch Begleitungen, außer Kleinkindern) wählt pro Gang eine Option. Gänge und Optionen, die schon gewählt wurden, lassen sich nicht entfernen oder umbenennen; neue Gänge müssen bisherige Gäste beim nächsten Bearbeiten wählen.</p>
    </div>
  )
}
