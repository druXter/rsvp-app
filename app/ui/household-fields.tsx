// app/ui/household-fields.tsx
'use client'

import { useState } from 'react'
import { AGE_GROUPS, AGE_GROUP_LABEL, DIET_OPTIONS, asAgeGroup } from '../lib/persons'
import type { MenuCourseForForm } from '../lib/menu'
import type { HouseholdPersonInput } from '../lib/invitations'
import MenuSelects from './menu-selects'
import { AlcoholSelect } from './companion-fields'
import { inputClass } from './kit'

export type HouseholdFormRow = HouseholdPersonInput & { answered: boolean }

/**
 * Antwort eines eingeladenen Haushalts (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): jede eingeladene Person mit
 * Zu-/Absage, korrigierbarem Namen und - wenn sie kommt - Essen, Allergien, Alkohol (Erwachsene) und Menü; dazu bis
 * zu `extraPersons` selbst eingetragene Personen. Felder person_<i>_id/_name/_age/_attending/_diet/_allergies/_alcohol/_menu_<Gang>, gelesen
 * von readHousehold. `onAttendingChange` meldet, ob jemand kommt (für die übrigen Felder des Formulars). Mit `allowMaybe`
 * gibt es pro eingeladener Person auch „vielleicht“ (app/lib/maybe.ts, Wert `maybe`), gemeldet über `onMaybeChange`.
 */
export default function HouseholdFields({ rows, extraPersons, askDiet, askAllergies, askAlcohol = false, menu, onAttendingChange, allowMaybe = false, onMaybeChange }: {
  rows: HouseholdFormRow[]
  extraPersons: number
  askDiet: boolean
  askAllergies: boolean
  askAlcohol?: boolean
  menu: MenuCourseForForm[]
  onAttendingChange: (anyAttending: boolean | null) => void
  allowMaybe?: boolean
  onMaybeChange?: (anyMaybe: boolean) => void
}) {
  const invited = rows.filter(r => r.invitationPersonId)
  // Pro eingeladener Person: kommt (true), kommt nicht (false), vielleicht ('maybe') oder noch offen (null). Ein
  // „vielleicht“, das nicht mehr wählbar ist, ist wieder offen.
  const [attending, setAttending] = useState<(boolean | 'maybe' | null)[]>(() => invited.map(r => (!r.answered ? null : r.isMaybe ? (allowMaybe ? 'maybe' : null) : r.isAttending)))
  const [extras, setExtras] = useState(() => rows.filter(r => !r.invitationPersonId).map((r, i) => ({ key: i, row: r, age: r.ageGroup as string })))
  const [nextKey, setNextKey] = useState(extras.length)

  const report = (nextAttending: (boolean | 'maybe' | null)[], nextExtras: typeof extras) => {
    const comes = nextAttending.some((a, i) => a === true && invited[i].ageGroup !== 'INFANT') || nextExtras.some(e => e.age !== 'INFANT')
    onAttendingChange(comes ? true : nextAttending.every(a => a !== null) ? false : null)
    onMaybeChange?.(nextAttending.some(a => a === 'maybe'))
  }
  const choices: [boolean | 'maybe', string][] = [[true, 'kommt'], [false, 'kommt nicht'], ...(allowMaybe ? [['maybe', 'vielleicht'] as [boolean | 'maybe', string]] : [])]

  const details = (i: number, row: HouseholdPersonInput, who: string, ageGroup: string) => (
    <div className="space-y-2">
      {(askDiet || askAllergies || (askAlcohol && asAgeGroup(ageGroup) === 'ADULT')) && (
        <div className="flex flex-col sm:flex-row gap-2">
          {askDiet && (
            <select name={`person_${i}_diet`} defaultValue={row.dietaryOption ?? ''} aria-label={`Essenswunsch von ${who}`} className={inputClass}>
              <option value="">Essenswunsch …</option>
              {DIET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          )}
          {askAllergies && (
            <input name={`person_${i}_allergies`} defaultValue={row.allergies ?? ''} maxLength={300} aria-label={`Allergien von ${who}`} placeholder="Allergien (optional)" className={inputClass} />
          )}
          {askAlcohol && asAgeGroup(ageGroup) === 'ADULT' && <AlcoholSelect name={`person_${i}_alcohol`} value={row.drinksAlcohol} label={`Alkohol von ${who}`} required />}
        </div>
      )}
      {menu.length > 0 && asAgeGroup(ageGroup) !== 'INFANT' && <MenuSelects courses={menu} prefix={`person_${i}_menu_`} selection={row.menu} who={`für ${who}`} />}
    </div>
  )

  return (
    <fieldset className="space-y-3" data-testid="household">
      <legend className="block text-sm font-medium mb-1">Wer von euch kommt?</legend>
      <input type="hidden" name="householdShown" value="1" />
      {menu.length > 0 && <input type="hidden" name="menuShown" value="1" />}
      {invited.map((row, i) => (
        <div key={row.invitationPersonId} className="p-3 rounded border border-gray-200 dark:border-gray-700 space-y-2">
          <input type="hidden" name={`person_${i}_id`} value={row.invitationPersonId!} />
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <label htmlFor={`person_${i}_name`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name{row.ageGroup !== 'ADULT' ? ` (${AGE_GROUP_LABEL[row.ageGroup]})` : ''}
              </label>
              <input id={`person_${i}_name`} name={`person_${i}_name`} defaultValue={row.name} required maxLength={100} className={inputClass} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2" role="radiogroup" aria-label={`Kommt ${row.name}?`}>
              {choices.map(([value, label]) => (
                <label key={String(value)} className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="radio" name={`person_${i}_attending`} value={String(value)} required
                    defaultChecked={attending[i] === value}
                    onChange={() => {
                      const next = attending.map((a, j) => (j === i ? value : a))
                      setAttending(next)
                      report(next, extras)
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {attending[i] === true && details(i, row, row.name, row.ageGroup)}
        </div>
      ))}

      {extras.map(({ key, row, age }, j) => {
        const i = invited.length + j
        return (
          <div key={key} className="p-3 rounded border border-dashed border-gray-300 dark:border-gray-600 space-y-2">
            <input type="hidden" name={`person_${i}_attending`} value="true" />
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor={`person_${i}_name`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Weitere Person</label>
                <input id={`person_${i}_name`} name={`person_${i}_name`} defaultValue={row.name} required maxLength={100} className={inputClass} />
              </div>
              <div>
                <label htmlFor={`person_${i}_age`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alter</label>
                <select
                  id={`person_${i}_age`} name={`person_${i}_age`} defaultValue={row.ageGroup} className={inputClass}
                  onChange={e => {
                    const next = extras.map(x => (x.key === key ? { ...x, age: e.target.value } : x))
                    setExtras(next)
                    report(attending, next)
                  }}
                >
                  {AGE_GROUPS.map(group => <option key={group} value={group}>{AGE_GROUP_LABEL[group]}</option>)}
                </select>
              </div>
              <button
                type="button" className="px-2 py-2 text-sm text-red-600 hover:text-red-800 dark:text-red-400" aria-label={`Weitere Person ${j + 1} entfernen`}
                onClick={() => {
                  const next = extras.filter(x => x.key !== key)
                  setExtras(next)
                  report(attending, next)
                }}
              >
                ✕
              </button>
            </div>
            {details(i, row, row.name || 'die weitere Person', age)}
          </div>
        )
      })}

      {extras.length < extraPersons && (
        <button
          type="button" className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
          onClick={() => {
            const next = [...extras, { key: nextKey, row: { invitationPersonId: null, name: '', ageGroup: 'ADULT' as const, isAttending: true, isMaybe: false, dietaryOption: null, allergies: null, menu: {}, drinksAlcohol: null, answered: false }, age: 'ADULT' }]
            setExtras(next)
            setNextKey(nextKey + 1)
            report(attending, next)
          }}
        >
          + Weitere Person ({extras.length}/{extraPersons})
        </button>
      )}
    </fieldset>
  )
}
