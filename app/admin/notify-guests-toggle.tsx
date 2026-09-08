// app/admin/notify-guests-toggle.tsx
'use client'

import { useEffect, useState } from 'react'
import { themeClasses } from '../ui/theme-section'

type OriginalValues = {
  title: string
  date: string
  duration: string
  location: string
  description: string
}

/**
 * Blendet die "Teilnehmende benachrichtigen"-Checkbox nur ein, solange sich mindestens
 * eines der für Gäste relevanten Felder (Titel/Datum/Dauer/Ort/Beschreibung, siehe
 * diffEventFields in app/admin/actions.ts) tatsächlich vom gespeicherten Wert
 * unterscheidet - verhindert ein irreführend anhakbares Häkchen, wenn beim Speichern
 * ohnehin nichts Benachrichtigenswertes geändert wurde (z.B. nur ein Tippfehler in einer
 * abgefragten Zusatzfrage). `formId` verweist auf das umgebende Formular, dessen Felder
 * hier per input-Event beobachtet werden.
 */
export default function NotifyGuestsToggle({ formId, original }: { formId: string; original: OriginalValues }) {
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null
    if (!form) return

    function check() {
      const data = new FormData(form!)
      const changed =
        (data.get('title') as string || '') !== original.title ||
        (data.get('date') as string || '') !== original.date ||
        (data.get('duration') as string || '') !== original.duration ||
        (data.get('location') as string || '') !== original.location ||
        (data.get('description') as string || '') !== original.description
      setHasChanges(changed)
    }

    check()
    form.addEventListener('input', check)
    return () => form.removeEventListener('input', check)
  }, [formId, original])

  if (!hasChanges) return null

  const c = themeClasses('amber')
  return (
    <div className={`space-y-2 pt-4 border-t border-gray-200 ${c.box} p-4 rounded-md`}>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" name="notifyGuests" className={`w-4 h-4 ${c.accent}`} />
        <span className={`text-sm font-medium ${c.heading}`}>⚠️ Teilnehmende über diese Änderung per E-Mail informieren</span>
      </label>
      <p className={`text-xs ${c.text}`}>
        Alle Gäste mit fester Zusage oder Wartelisten-Platz erhalten eine E-Mail mit den geänderten Angaben sowie
        (bei fester Zusage) einer aktualisierten Kalenderdatei (.ics).
      </p>
    </div>
  )
}
