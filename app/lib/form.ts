// app/lib/form.ts

/** Formularwerte sind String ODER Datei (oder null) - diese Helfer liefern immer einen String. */
export function formString(formData: FormData, name: string, maxLength = 500): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

/** Wie formString, aber ohne trim() - Passwörter dürfen führende/folgende Leerzeichen enthalten. */
export function formPassword(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' && value.length <= 1000 ? value : ''
}
