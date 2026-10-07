// app/lib/photo-link.ts
//
// Foto-Link (Idee Q3 der Suite, suite-kit docs/IDEEN.md): Statt eigener Foto-Funktion verweist ein Event auf
// ein geteiltes Album mit Upload-Link, z. B. in Immich. rsvp-app speichert nur diesen Link.

export const PHOTO_URL_MAX_LENGTH = 2000

/**
 * Prüft den Foto-Link aus dem Termin-Formular: leer = kein Link, sonst nur http(s) - der Link landet als
 * href auf der Gästeseite, `javascript:` & Co. dürfen nie hinein. Wirft mit einer Meldung fürs Formular.
 */
export function parsePhotoUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Ungültiger Foto-Link. Erwartet wird eine vollständige Adresse, z. B. https://fotos.example.de/s/hochzeit.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Der Foto-Link muss mit https:// (oder http://) beginnen.')
  }
  if (value.length > PHOTO_URL_MAX_LENGTH) throw new Error(`Der Foto-Link ist zu lang (höchstens ${PHOTO_URL_MAX_LENGTH} Zeichen).`)
  return url.toString()
}

/** Ende eines Termins: Beginn plus Dauer in Stunden (wie im Kalendereintrag, app/lib/mail.ts). */
export function eventEndsAt(event: { date: Date; duration: number }): Date {
  return new Date(event.date.getTime() + event.duration * 60 * 60 * 1000)
}

/**
 * Sieht diese Person den Foto-Link? Erst ab dem Ende des Termins (vorher gibt es keine Fotos, und
 * ein offener Upload-Link soll nicht wochenlang vorher herumliegen) und nur mit Zusage, nicht auf
 * der Warteliste: Das Album gehört den Gästen, nicht allen, die den Link zur Eventseite kennen.
 * Mit offenem Datum (Terminabstimmung läuft) nie.
 */
export function photoLinkVisible(
  event: { photoUrl: string | null; date: Date; duration: number; datePending: boolean },
  rsvp: { isAttending: boolean; isOnWaitlist: boolean } | null,
  now: Date = new Date()
): boolean {
  if (!event.photoUrl || event.datePending) return false
  if (!rsvp?.isAttending || rsvp.isOnWaitlist) return false
  return now >= eventEndsAt(event)
}
