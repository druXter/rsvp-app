// app/lib/rsvp-note.ts
//
// Interne Notiz der Verwaltung zu einer Antwort ("telefonisch zugesagt"): beim Gast eintragen und beim Bearbeiten,
// sichtbar in der Gästeliste und im CSV-Export - nie für den Gast (eigene Tabelle RsvpNote, siehe prisma/schema.prisma).
import { prisma } from './prisma'
import { formString } from './form'

export const RSVP_NOTE_MAX = 500

/** Notiz aus dem Formular (Feld adminNote), leer = keine Notiz. */
export function readRsvpNote(formData: FormData): string | null {
  return formString(formData, 'adminNote', RSVP_NOTE_MAX) || null
}

/** Speichert die Notiz einer Antwort; null löscht sie. */
export async function saveRsvpNote(rsvpId: string, text: string | null): Promise<void> {
  if (text) await prisma.rsvpNote.upsert({ where: { rsvpId }, create: { rsvpId, text }, update: { text } })
  else await prisma.rsvpNote.deleteMany({ where: { rsvpId } })
}
