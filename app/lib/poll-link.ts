// app/lib/poll-link.ts
import type { GuestUser } from '@prisma/client'
import { prisma } from './prisma'
import { signPollVerificationToken } from './poll-verification'

/**
 * Ermittelt, ob das Nutzer-Konto für GENAU DIESES Event aktuell zugesagt hat -
 * frisch bei jedem Aufruf nachgeschlagen (kein Zwischenspeichern), damit eine
 * nachträglich geänderte Antwort sich beim nächsten Klick sofort im Token
 * widerspiegelt (siehe signPollVerificationToken). guestUserId wird nur bei
 * Reihen-Participants gesetzt (siehe schema.prisma) - für ein Einzel-Event ohne
 * Reihe gibt es keine über ein Nutzer-Konto auflösbare Identität, daher dort immer
 * false (fail-closed, wie überall sonst in dieser Kopplung: nicht auflösbar heißt
 * nicht abstimmberechtigt, nicht automatisch erlaubt).
 */
export async function resolveCurrentAttendance(event: { id: string; seriesId: string | null }, guestUserId: string): Promise<boolean> {
  if (!event.seriesId) return false

  const participant = await prisma.participant.findFirst({
    where: { guestUserId, seriesId: event.seriesId }
  })
  if (!participant) return false

  const rsvp = await prisma.rsvp.findUnique({
    where: { eventId_participantId: { eventId: event.id, participantId: participant.id } }
  })
  return rsvp?.isAttending ?? false
}

export type PollLink = { url: string; verified: boolean; attending: boolean }

/**
 * Persönlicher Link zur Abstimmung eines Termins (Event.pollUrl) für ein Nutzer-Konto: Ist es
 * bestätigt, hängt ein kurzlebiger, signierter Token an (?verify=...), der die E-Mail und die
 * aktuelle Zusage trägt. Ohne bestätigtes Konto, ohne POLL_VERIFICATION_SECRET oder bei einer
 * ungültigen pollUrl bleibt es die bloße Abstimmungs-URL (`verified: false`) - das
 * Abstimmungstool entscheidet dann selbst, ob das für die Abstimmung reicht. Gemeinsam für den
 * Knopf auf der Seite (/api/poll-link/[eventId]) und die Client-API.
 */
export async function personalPollLink(event: { id: string; seriesId: string | null; pollUrl: string }, guestUser: GuestUser | null): Promise<PollLink> {
  if (!guestUser?.isVerified) return { url: event.pollUrl, verified: false, attending: false }

  const attending = await resolveCurrentAttendance(event, guestUser.id)
  const token = signPollVerificationToken(guestUser.email, event.pollUrl, attending)
  if (token) {
    try {
      const target = new URL(event.pollUrl)
      target.searchParams.set('verify', token)
      return { url: target.toString(), verified: true, attending }
    } catch {
      // Ungültige pollUrl - unverändert (ohne Token) weitergeben.
    }
  }
  return { url: event.pollUrl, verified: false, attending }
}
