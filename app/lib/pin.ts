// app/lib/pin.ts
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { safeEqual } from './tokens'

/**
 * Event-/Reihen-PIN: EINE gemeinsame Prüfung für alles, was dahinter liegt. Die PIN wurde früher
 * nur beim Rendern der Seiten geprüft (das PIN-Formular statt des Inhalts) - jede Server Action
 * und jeder API-Endpunkt, der ein Event über seine ID erreicht, umging sie damit vollständig:
 * Antworten abgeben, Kalenderdatei (Titel/Ort/Beschreibung), Abstimmungs-Link, Konto-Registrierung
 * für die Reihe. Wer die Event-ID kennt (steht als verstecktes Feld sogar im PIN-Formular), brauchte
 * keine PIN. Deshalb prüft jeder dieser Wege jetzt hier.
 *
 * Wie überall in dieser App gilt bei einem Termin einer Reihe die PIN der REIHE, die PIN am
 * Event-Datensatz ist dann wirkungslos (siehe CLAUDE.md "Effective settings").
 */
type Series = { id: string; eventPin: string | null }
type EventWithSeries = { id: string; eventPin: string | null; series?: Series | null }

async function cookieMatches(cookieName: string, pin: string): Promise<boolean> {
  const value = (await cookies()).get(cookieName)?.value
  // Konstantzeitvergleich: das Cookie trägt die PIN selbst, ein Vergleich mit === wäre ein Timing-Orakel.
  return !!value && safeEqual(value, pin)
}

export async function hasSeriesPinAccess(series: Series): Promise<boolean> {
  return !series.eventPin || cookieMatches(`series_pin_${series.id}`, series.eventPin)
}

export async function hasEventPinAccess(event: EventWithSeries): Promise<boolean> {
  if (event.series) return hasSeriesPinAccess(event.series)
  return !event.eventPin || cookieMatches(`event_pin_${event.id}`, event.eventPin)
}

/**
 * Ein persönlicher Link mit editToken (z.B. der Kalender-Anhang aus der Bestätigungs-Mail) muss auch
 * OHNE PIN-Cookie funktionieren - aber nur, wenn der Token wirklich zu einem Teilnehmer DIESES
 * Termins bzw. dieser Reihe gehört. Ein beliebiger oder fremder Token gilt nicht.
 */
export async function tokenBelongsToEvent(token: string | null, event: { id: string; seriesId: string | null }): Promise<boolean> {
  if (!token) return false
  const participant = await prisma.participant.findUnique({ where: { editToken: token } })
  if (!participant) return false
  if (event.seriesId) return participant.seriesId === event.seriesId
  return !!(await prisma.rsvp.findUnique({
    where: { eventId_participantId: { eventId: event.id, participantId: participant.id } },
    select: { id: true }
  }))
}
