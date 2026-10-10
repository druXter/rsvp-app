// app/ui/companion-fields.tsx
'use client'

import { useState } from 'react'
import { AGE_GROUPS, AGE_GROUP_LABEL, DIET_OPTIONS, type CompanionInput } from '../lib/persons'

const INPUT = 'w-full border border-gray-300 p-2 rounded-md bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100'

/**
 * Begleitungen mit Name, Altersgruppe und - wenn der Termin danach fragt - Essen und Allergien (app/lib/persons.ts,
 * docs/KONZEPT-EINLADUNGEN.md). Für das Gästeformular und die Verwaltung (edit-rsvp). Die Felder heißen
 * companion_<i>_name/_age/_diet/_allergies, readCompanions liest sie; companionsShown sagt dem Server, dass die
 * Liste angezeigt wurde (ohne bleiben die bisherigen Begleitungen).
 */
export default function CompanionFields({
  max,
  initial,
  askDiet,
  askAllergies,
  heading = 'Begleitungen'
}: {
  max: number
  initial: CompanionInput[]
  askDiet: boolean
  askAllergies: boolean
  heading?: string
}) {
  // Schlüssel pro Zeile, damit das Entfernen einer Zeile nicht die Eingaben der folgenden verschiebt
  const [rows, setRows] = useState(() => initial.map((companion, i) => ({ key: i, companion })))
  const [nextKey, setNextKey] = useState(initial.length)

  const add = () => {
    setRows([...rows, { key: nextKey, companion: { name: '', ageGroup: 'ADULT', dietaryOption: null, allergies: null } }])
    setNextKey(nextKey + 1)
  }

  return (
    <fieldset className="space-y-3" data-testid="companions">
      <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {heading} <span className="font-normal text-gray-500 dark:text-gray-400">(bis zu {max})</span>
      </legend>
      <input type="hidden" name="companionsShown" value="1" />
      {rows.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Keine Begleitung.</p>}
      {rows.map(({ key, companion }, i) => (
        <div key={key} className="p-3 rounded border border-gray-200 dark:border-gray-700 space-y-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor={`companion_${i}_name`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name der {i + 1}. Begleitung</label>
              <input id={`companion_${i}_name`} name={`companion_${i}_name`} defaultValue={companion.name} required maxLength={100} className={INPUT} />
            </div>
            <div>
              <label htmlFor={`companion_${i}_age`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alter</label>
              <select id={`companion_${i}_age`} name={`companion_${i}_age`} defaultValue={companion.ageGroup} className={INPUT}>
                {AGE_GROUPS.map(group => <option key={group} value={group}>{AGE_GROUP_LABEL[group]}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setRows(rows.filter(r => r.key !== key))} className="px-2 py-2 text-sm text-red-600 hover:text-red-800 dark:text-red-400" aria-label={`${i + 1}. Begleitung entfernen`}>
              ✕
            </button>
          </div>
          {(askDiet || askAllergies) && (
            <div className="flex flex-col sm:flex-row gap-2">
              {askDiet && (
                <select name={`companion_${i}_diet`} defaultValue={companion.dietaryOption ?? ''} aria-label={`Essenswunsch der ${i + 1}. Begleitung`} className={INPUT}>
                  <option value="">Essenswunsch …</option>
                  {DIET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              )}
              {askAllergies && (
                <input name={`companion_${i}_allergies`} defaultValue={companion.allergies ?? ''} maxLength={300} aria-label={`Allergien der ${i + 1}. Begleitung`} placeholder="Allergien (optional)" className={INPUT} />
              )}
            </div>
          )}
        </div>
      ))}
      {rows.length < max && (
        <button type="button" onClick={add} className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400">
          + Begleitung hinzufügen
        </button>
      )}
    </fieldset>
  )
}
