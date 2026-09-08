// app/ui/theme-section.tsx

/**
 * Feste, projektweite Farb-Palette für thematisch abgegrenzte Formular-Abschnitte (siehe
 * CLAUDE.md "Farbschema"). Jedes Thema bekommt genau EINE Farbe, die überall im Projekt
 * gilt - ein neues Thema braucht eine bewusste Entscheidung für eine noch unbenutzte Farbe
 * aus dieser Liste statt einer zufällig gewählten Tailwind-Klasse. Die Klassen-Strings
 * müssen hier als Literale stehen (nicht z.B. `bg-${color}-50` zusammengebaut), damit
 * Tailwinds Build-Scan sie findet.
 */
export type ThemeColor = 'yellow' | 'sky' | 'teal' | 'indigo' | 'rose' | 'emerald' | 'purple' | 'gray' | 'amber'

const THEME_CLASSES: Record<ThemeColor, {
  box: string
  heading: string
  text: string
  accent: string
  border: string
  borderFocus: string
}> = {
  yellow:  { box: 'bg-yellow-50',  heading: 'text-yellow-900',  text: 'text-yellow-700',  accent: 'text-yellow-600',  border: 'border-yellow-300',  borderFocus: 'focus:border-yellow-500' },
  sky:     { box: 'bg-sky-50',     heading: 'text-sky-900',     text: 'text-sky-700',     accent: 'text-sky-600',     border: 'border-sky-300',     borderFocus: 'focus:border-sky-500' },
  teal:    { box: 'bg-teal-50',    heading: 'text-teal-900',    text: 'text-teal-700',    accent: 'text-teal-600',    border: 'border-teal-300',    borderFocus: 'focus:border-teal-500' },
  indigo:  { box: 'bg-indigo-50',  heading: 'text-indigo-900',  text: 'text-indigo-700',  accent: 'text-indigo-600',  border: 'border-indigo-300',  borderFocus: 'focus:border-indigo-500' },
  rose:    { box: 'bg-rose-50',    heading: 'text-rose-900',    text: 'text-rose-700',    accent: 'text-rose-600',    border: 'border-rose-300',    borderFocus: 'focus:border-rose-500' },
  emerald: { box: 'bg-emerald-50', heading: 'text-emerald-900', text: 'text-emerald-700', accent: 'text-emerald-600', border: 'border-emerald-300', borderFocus: 'focus:border-emerald-500' },
  purple:  { box: 'bg-purple-50',  heading: 'text-purple-900',  text: 'text-purple-700',  accent: 'text-purple-600',  border: 'border-purple-300',  borderFocus: 'focus:border-purple-500' },
  gray:    { box: 'bg-gray-50',    heading: 'text-gray-900',    text: 'text-gray-700',    accent: 'text-gray-600',    border: 'border-gray-300',    borderFocus: 'focus:border-gray-500' },
  amber:   { box: 'bg-amber-50',   heading: 'text-amber-900',   text: 'text-amber-700',   accent: 'text-amber-600',   border: 'border-amber-300',   borderFocus: 'focus:border-amber-500' },
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
    <div className={`space-y-3 pt-4 border-t border-gray-200 ${c.box} p-4 rounded-md`}>
      <h3 className={`font-bold ${c.heading}`}>{title}</h3>
      {description && <p className={`text-xs ${c.text} mb-2`}>{description}</p>}
      {children}
    </div>
  )
}
