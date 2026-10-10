// app/admin/menu-settings-section.tsx
import ThemeSection, { themeClasses } from '../ui/theme-section'
import { formatMenu, type MenuCourseInput } from '../lib/menu'

/**
 * "Menü" im Termin-Formular (Anlegen, Bearbeiten, Reihen-Termin): Gänge mit Optionen (app/lib/menu.ts), gelesen
 * von readMenu in app/admin/actions.ts. Farbe orange = Menü und Küche (siehe CLAUDE.md "Farbschema").
 */
export default function MenuSettingsSection({ courses }: { courses?: MenuCourseInput[] }) {
  return (
    <ThemeSection color="orange" title="Menü" description="Optional: Gänge mit Auswahl, z. B. für eine Hochzeit oder einen Ball. Jede Person mit Zusage (auch Begleitungen, außer Kleinkindern) wählt pro Gang eine Option. Die Küchenübersicht in der Gästeliste zählt die Wahl und listet Allergien.">
      <div>
        <label htmlFor="menu" className={`block text-sm font-medium mb-1 ${themeClasses('orange').heading}`}>Gänge (Optional)</label>
        <textarea id="menu" name="menu" rows={3} defaultValue={courses ? formatMenu(courses) : ''} className={`w-full border ${themeClasses('orange').border} bg-white dark:bg-gray-800 dark:text-gray-100 p-2 rounded outline-none ${themeClasses('orange').borderFocus}`} placeholder={'Vorspeise: Suppe; Salat\nHauptgang: Fisch; Fleisch; Vegetarisch\nKinder: Nudeln; Pommes'} />
        <p className={`text-xs ${themeClasses('orange').text} mt-1`}>Eine Zeile pro Gang: Name, Doppelpunkt, Optionen mit Semikolon getrennt. Ein Kindermenü ist einfach eine weitere Option. Gänge und Optionen, die schon gewählt wurden, lassen sich nicht entfernen oder umbenennen; neue Gänge müssen bisherige Gäste beim nächsten Bearbeiten wählen.</p>
      </div>
    </ThemeSection>
  )
}
