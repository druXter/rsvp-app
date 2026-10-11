// app/admin/field-rules.tsx
'use client'

import { useEffect } from 'react'

/**
 * Abhängigkeiten zwischen Feldern eines Einstellungs-Formulars:
 * - `excludes`: zwei Felder schließen sich aus (z. B. „Nur mit Einladung“ und PIN). Ist eins an, wird das andere
 *   gesperrt.
 * - `requires`: ein Feld braucht ein anderes (z. B. Erinnerung an Einladungen braucht eine Antwortfrist). Ohne das
 *   andere wird es gesperrt, `hint` sagt, was fehlt.
 * - `fixed`: Feld ist aus einem festen Grund gesperrt (z. B. Konto-Pflicht, beim Anlegen festgelegt).
 * Sind beide Seiten schon an (alte Daten), sperrt nichts, die Hinweise sagen, was nicht zusammen geht. Der Server
 * prüft dieselben Regeln (assertInviteOnlyAllowed usw. in app/admin/actions.ts).
 */
export type FieldRule =
  | { excludes: [string, string] }
  | { requires: string; needs: string; hint: string }

type Control = HTMLInputElement | HTMLTextAreaElement

const isCheckbox = (el: Control) => el instanceof HTMLInputElement && el.type === 'checkbox'

function isOn(el: Control): boolean {
  if (isCheckbox(el)) return (el as HTMLInputElement).checked
  if (el instanceof HTMLInputElement && el.type === 'number') return Number(el.value) > 0
  return el.value.trim() !== ''
}

function lock(el: Control, locked: boolean) {
  // Checkbox: disabled (nicht angehakt = wird ohnehin nicht gesendet); Textfelder: readOnly, damit der (leere)
  // Wert weiter mitgeschickt wird
  if (isCheckbox(el)) (el as HTMLInputElement).disabled = locked
  else el.readOnly = locked
  if (locked) el.setAttribute('aria-disabled', 'true')
  else el.removeAttribute('aria-disabled')
  ;(el.closest('label') ?? el).classList.toggle('opacity-50', locked)
}

export default function FieldRules({ formId, labels, rules, fixed = {} }: {
  formId: string
  /** Bezeichnung pro Feldname für "geht nicht zusammen mit …" */
  labels: Record<string, string>
  rules: FieldRule[]
  /** Feldname → Grund, aus dem es gesperrt ist */
  fixed?: Record<string, string>
}) {
  useEffect(() => {
    const form = document.getElementById(formId)
    if (!(form instanceof HTMLFormElement)) return
    const control = (name: string): Control | null => {
      const el = form.elements.namedItem(name)
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
    }

    const update = () => {
      const locks = new Map<string, string[]>()
      const warnings = new Map<string, string[]>()
      const add = (map: Map<string, string[]>, name: string, text: string) => map.set(name, [...(map.get(name) ?? []), text])

      for (const rule of rules) {
        if ('excludes' in rule) {
          const [a, b] = rule.excludes
          const elA = control(a), elB = control(b)
          if (!elA || !elB) continue
          if (isOn(elA) && isOn(elB)) {
            add(warnings, a, `Geht nicht zusammen mit ${labels[b]} - bitte eins von beiden entfernen.`)
            add(warnings, b, `Geht nicht zusammen mit ${labels[a]} - bitte eins von beiden entfernen.`)
          } else if (isOn(elA)) add(locks, b, `geht nicht zusammen mit ${labels[a]}`)
          else if (isOn(elB)) add(locks, a, `geht nicht zusammen mit ${labels[b]}`)
        } else {
          const el = control(rule.requires), needed = control(rule.needs)
          if (!el || !needed || isOn(needed)) continue
          add(isOn(el) ? warnings : locks, rule.requires, rule.hint)
        }
      }
      for (const [name, reason] of Object.entries(fixed)) {
        const el = control(name)
        if (el) add(isOn(el) ? warnings : locks, name, reason)
      }

      const names = new Set([...rules.flatMap(r => ('excludes' in r ? r.excludes : [r.requires])), ...Object.keys(fixed)])
      for (const name of names) {
        const el = control(name)
        if (!el) continue
        const locked = locks.get(name) ?? []
        const warned = warnings.get(name) ?? []
        lock(el, locked.length > 0)
        const note = document.getElementById(`rule-${name}`)
        if (!note) continue
        note.textContent = locked.length > 0 ? `🔒 Gesperrt: ${locked.join('; ')}.` : warned.length > 0 ? `⚠️ ${warned.join(' ')}` : ''
        note.dataset.tone = warned.length > 0 && locked.length === 0 ? 'warn' : 'lock'
      }
    }

    update()
    form.addEventListener('input', update)
    form.addEventListener('change', update)
    return () => {
      form.removeEventListener('input', update)
      form.removeEventListener('change', update)
    }
  }, [formId, labels, rules, fixed])

  return null
}

/** Platz für den Hinweis zu einem Feld (von FieldRules gefüllt). `indent`: unter dem Text einer Checkbox. */
export function RuleNote({ name, indent = false }: { name: string; indent?: boolean }) {
  return (
    <p id={`rule-${name}`} aria-live="polite" data-testid={`rule-${name}`}
      className={`text-xs empty:hidden text-gray-600 data-[tone=warn]:text-amber-700 dark:text-gray-400 dark:data-[tone=warn]:text-amber-300 ${indent ? 'ml-7 -mt-2' : 'mt-1'}`} />
  )
}
