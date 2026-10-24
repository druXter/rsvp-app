// app/api/v1/termine/[eventId]/abstimmung/route.ts
import { prisma } from '../../../../../lib/prisma'
import { getGuestUserFromApiToken, apiError } from '../../../../../lib/api-auth'
import { personalPollLink } from '../../../../../lib/poll-link'

const TTL_SECONDS = 600

/**
 * Persönlicher Link zur Abstimmung eines Termins - das API-Gegenstück zum Knopf „Zur Abstimmung“
 * auf der Seite (/api/poll-link/[eventId]), z.B. für einen Chat-Bot, der ihn nur der Person
 * selbst zeigt. Dieselbe Regel wie dort (app/lib/poll-link.ts): Der Token trägt E-Mail und
 * aktuelle Zusage, wird bei jedem Abruf frisch ausgestellt und gilt 10 Minuten nur für diese
 * Abstimmung; wer nicht zugesagt hat, wird im Abstimmungstool blockiert. Nur für Termine aus
 * Reihen, denen das Konto angehört (wie POST .../antwort), und nur mit bestätigtem Konto -
 * ohne Bestätigung trüge der Link keinen Nachweis und wäre für eine Abstimmung mit Kopplung
 * wertlos.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const guestUser = await getGuestUserFromApiToken(request)
  if (!guestUser) return apiError(401, 'Ungültiger oder fehlender API-Token')

  const { eventId } = await params
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !event.seriesId) return apiError(404, 'Termin nicht gefunden')

  const membership = await prisma.guestUserSeries.findUnique({
    where: { guestUserId_seriesId: { guestUserId: guestUser.id, seriesId: event.seriesId } }
  })
  if (!membership) return apiError(403, 'Kein Zugriff auf diesen Termin')
  if (!event.pollUrl) return apiError(404, 'Dieser Termin hat keine Abstimmung')
  if (!guestUser.isVerified) return apiError(403, 'Bitte bestätige zuerst die E-Mail-Adresse deines Kontos')

  const link = await personalPollLink({ ...event, pollUrl: event.pollUrl }, guestUser)
  return Response.json({
    url: link.url,
    label: event.pollLabel || null,
    // false: Das Abstimmungstool ist hier nicht angebunden (kein POLL_VERIFICATION_SECRET), der Link trägt keinen Nachweis.
    verified: link.verified,
    attending: link.attending,
    expiresAt: link.verified ? new Date(Date.now() + TTL_SECONDS * 1000).toISOString() : null
  }, { headers: { 'cache-control': 'no-store' } })
}
