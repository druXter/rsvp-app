// app/ui/menu-selects.tsx
import type { MenuCourseForForm, MenuSelection } from '../lib/menu'
import { inputClass } from './kit'

/**
 * Auswahl je Gang für eine Person (app/lib/menu.ts), Felder `<prefix><Gang-ID>`. Für die anmeldende Person
 * (prefix menu_) und jede Begleitung (companion_<i>_menu_). `who` steht in den Beschriftungen ("für Max").
 */
export default function MenuSelects({ courses, prefix, selection, who, required = true }: {
  courses: MenuCourseForForm[]
  prefix: string
  selection: MenuSelection
  who: string
  required?: boolean
}) {
  if (courses.length === 0) return null
  return (
    <div className="grid sm:grid-cols-2 gap-2" data-testid="menu-selects">
      {courses.map(course => (
        <div key={course.id}>
          <label htmlFor={`${prefix}${course.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{course.label} {who}</label>
          <select id={`${prefix}${course.id}`} name={`${prefix}${course.id}`} defaultValue={selection[course.id] ?? ''} required={required} className={inputClass}>
            <option value="">Bitte wählen …</option>
            {course.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}
