// app/ui/theme-section.tsx

/**
 * Feste, projektweite Farb-Palette für thematisch abgegrenzte Formular-Abschnitte (siehe
 * CLAUDE.md "Farbschema"). Jedes Thema bekommt genau EINE Farbe, die überall im Projekt
 * gilt - ein neues Thema braucht eine bewusste Entscheidung für eine noch unbenutzte Farbe
 * aus dieser Liste statt einer zufällig gewählten Tailwind-Klasse. Die Klassen-Strings
 * müssen hier als Literale stehen (nicht z.B. `bg-${color}-50` zusammengebaut), damit
 * Tailwinds Build-Scan sie findet.
 */
export type ThemeColor = 'yellow' | 'sky' | 'teal' | 'indigo' | 'rose' | 'emerald' | 'purple' | 'gray' | 'amber' | 'cyan'

const THEME_CLASSES: Record<ThemeColor, {
  box: string
  heading: string
  text: string
  accent: string
  border: string
  borderFocus: string
}> = {
  yellow:  { box: 'bg-yellow-50 dark:bg-yellow-950',   heading: 'text-yellow-900 dark:text-yellow-100',   text: 'text-yellow-700 dark:text-yellow-300',   accent: 'text-yellow-600 dark:text-yellow-400',   border: 'border-yellow-300 dark:border-yellow-800',   borderFocus: 'focus:border-yellow-500 dark:focus:border-yellow-500' },
  sky:     { box: 'bg-sky-50 dark:bg-sky-950',         heading: 'text-sky-900 dark:text-sky-100',         text: 'text-sky-700 dark:text-sky-300',         accent: 'text-sky-600 dark:text-sky-400',         border: 'border-sky-300 dark:border-sky-800',         borderFocus: 'focus:border-sky-500 dark:focus:border-sky-500' },
  teal:    { box: 'bg-teal-50 dark:bg-teal-950',       heading: 'text-teal-900 dark:text-teal-100',       text: 'text-teal-700 dark:text-teal-300',       accent: 'text-teal-600 dark:text-teal-400',       border: 'border-teal-300 dark:border-teal-800',       borderFocus: 'focus:border-teal-500 dark:focus:border-teal-500' },
  indigo:  { box: 'bg-indigo-50 dark:bg-indigo-950',   heading: 'text-indigo-900 dark:text-indigo-100',   text: 'text-indigo-700 dark:text-indigo-300',   accent: 'text-indigo-600 dark:text-indigo-400',   border: 'border-indigo-300 dark:border-indigo-800',   borderFocus: 'focus:border-indigo-500 dark:focus:border-indigo-500' },
  rose:    { box: 'bg-rose-50 dark:bg-rose-950',       heading: 'text-rose-900 dark:text-rose-100',       text: 'text-rose-700 dark:text-rose-300',       accent: 'text-rose-600 dark:text-rose-400',       border: 'border-rose-300 dark:border-rose-800',       borderFocus: 'focus:border-rose-500 dark:focus:border-rose-500' },
  emerald: { box: 'bg-emerald-50 dark:bg-emerald-950', heading: 'text-emerald-900 dark:text-emerald-100', text: 'text-emerald-700 dark:text-emerald-300', accent: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-300 dark:border-emerald-800', borderFocus: 'focus:border-emerald-500 dark:focus:border-emerald-500' },
  purple:  { box: 'bg-purple-50 dark:bg-purple-950',   heading: 'text-purple-900 dark:text-purple-100',   text: 'text-purple-700 dark:text-purple-300',   accent: 'text-purple-600 dark:text-purple-400',   border: 'border-purple-300 dark:border-purple-800',   borderFocus: 'focus:border-purple-500 dark:focus:border-purple-500' },
  gray:    { box: 'bg-gray-50 dark:bg-gray-800',       heading: 'text-gray-900 dark:text-gray-100',       text: 'text-gray-700 dark:text-gray-300',       accent: 'text-gray-600 dark:text-gray-400',       border: 'border-gray-300 dark:border-gray-600',       borderFocus: 'focus:border-gray-500 dark:focus:border-gray-500' },
  amber:   { box: 'bg-amber-50 dark:bg-amber-950',     heading: 'text-amber-900 dark:text-amber-100',     text: 'text-amber-700 dark:text-amber-300',     accent: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-300 dark:border-amber-800',     borderFocus: 'focus:border-amber-500 dark:focus:border-amber-500' },
  cyan:    { box: 'bg-cyan-50 dark:bg-cyan-950',       heading: 'text-cyan-900 dark:text-cyan-100',       text: 'text-cyan-700 dark:text-cyan-300',       accent: 'text-cyan-600 dark:text-cyan-400',       border: 'border-cyan-300 dark:border-cyan-800',       borderFocus: 'focus:border-cyan-500 dark:focus:border-cyan-500' },
}

/**
 * Gibt die feste Klassen-Kombination für ein Thema zurück, z.B. für einen Checkbox-Akzent
 * (`accent`) oder ein Eingabefeld (`border`/`borderFocus`) innerhalb einer ThemeSection.
 */
export function themeClasses(color: ThemeColor) {
  return THEME_CLASSES[color]
}

/**
 * Farblich abgesetzte Box für einen thematischen Formular-Abschnitt (z.B. "QR-Code
 * Einlasskontrolle", "Zugriff teilen"). Ersetzt die zuvor pro Seite von Hand kopierten
 * `bg-{farbe}-50 p-4 rounded-md`-Blöcke, damit dasselbe Thema nie versehentlich in
 * unterschiedlichen Farben auftaucht.
 */
export default function ThemeSection({
  color,
  title,
  description,
  children
}: {
  color: ThemeColor
  title: string
  description?: string
  children: React.ReactNode
}) {
  const c = THEME_CLASSES[color]
  return (
    <div className={`space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700 ${c.box} p-4 rounded-md`}>
      <h3 className={`font-bold ${c.heading}`}>{title}</h3>
      {description && <p className={`text-xs ${c.text} mb-2`}>{description}</p>}
      {children}
    </div>
  )
}
