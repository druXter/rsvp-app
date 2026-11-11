// app/lib/form.ts

import { singleLine } from 'suite-kit/web'

/** Formularwerte sind String ODER Datei (oder null) - diese Helfer liefern immer einen String. */
// Einzeilig (`singleLine` aus suite-kit): Zeilenumbrüche und Steuerzeichen werden ein Leerzeichen - Namen, Titel und
// Orte landen in Mails. Mehrzeilige Felder (Textarea) lesen mit formText.
export function formString(formData: FormData, name: string, maxLength = 500): string {
  const value = formData.get(name)
  return typeof value === 'string' ? singleLine(value).slice(0, maxLength) : ''
}

/**
 * Mehrzeiliger Text (Textarea): wie formString, aber Zeilenumbrüche bleiben, einheitlich als \n - Browser schicken
 * Textfelder mit \r\n.
 */
export function formText(formData: FormData, name: string, maxLength = 500): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength) : ''
}

/** Wie formString, aber ohne trim() - Passwörter dürfen führende/folgende Leerzeichen enthalten. */
export function formPassword(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' && value.length <= 1000 ? value : ''
}
