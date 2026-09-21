// app/api/v1/termine/[eventId]/antwort/route.ts
import { PrismaClient } from '@prisma/client'
import { getGuestUserFromApiToken, apiError } from '../../../../../lib/api-auth'
import { performRsvpSubmission } from '../../../../../lib/rsvp-submission'

const prisma = new PrismaClient()

/**
 * Antwort auf einen Termin abgeben oder ändern - das API-Gegenstück zum Web-Formular.
 * Nutzt bewusst dieselbe performRsvpSubmission (app/lib/rsvp-submission.ts) wie die Server
 * Action, damit Kapazität/Warteliste, Double-Opt-In sowie Bestätigungs-Mail bzw. -Push hier
 * exakt genauso ablaufen wie im Browser.
 *
 * Name und Profilangaben stammen immer aus dem Nutzer-Konto und sind absichtlich NICHT über
 * die API setzbar: ein Client soll eine Zu-/Absage abgeben können, aber nicht das zentrale
 * Profil überschreiben (das läuft weiter über /mein-konto). Erlaubt sind nur Termine aus
 * Reihen, denen das Konto angehört - Einzel-Events sind ausgeschlossen, weil dort keine
 * Konto-Identität existiert und stattdessen ein neuer anonymer Gast entstehen würde.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const guestUser = await getGuestUserFromApiToken(request)
  if (!guestUser) return apiError(401, 'Ungültiger oder fehlender API-Token')

  const { eventId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'Body muss gültiges JSON sein')
  }

  if (typeof body.isAttending !== 'boolean') {
    return apiError(400, 'Feld "isAttending" (true/false) fehlt')
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !event.seriesId) {
    return apiError(404, 'Termin nicht gefunden')
  }

  const membership = await prisma.guestUserSeries.findUnique({
    where: { guestUserId_seriesId: { guestUserId: guestUser.id, seriesId: event.seriesId } }
  })
  if (!membership) return apiError(403, 'Kein Zugriff auf diesen Termin')

  const customAnswers = Array.isArray(body.customAnswers)
    ? body.customAnswers.map(a => (typeof a === 'string' ? a : ''))
    : undefined

  const result = await performRsvpSubmission(
    {
      eventId,
      editToken: null,
      skipPinCheck: true, // Mitgliedschaft (GuestUserSeries) wurde oben geprüft
      name: guestUser.name,
      isAttending: body.isAttending,
      phone: guestUser.phone,
      dietaryOption: guestUser.dietaryOption,
      allergies: guestUser.allergies,
      emailInput: guestUser.email,
      drinksAlcohol: typeof body.drinksAlcohol === 'boolean' ? body.drinksAlcohol : null,
      additionalInfo: typeof body.additionalInfo === 'string' ? body.additionalInfo : null,
      declineReason: typeof body.declineReason === 'string' ? body.declineReason : null,
      plusOne: body.plusOne === true,
      plusOneName: typeof body.plusOneName === 'string' ? body.plusOneName : null,
      bringingItem: typeof body.bringingItem === 'string' ? body.bringingItem : null,
      customAnswers
    },
    guestUser
  )

  return Response.json({
    isAttending: body.isAttending,
    isOnWaitlist: result.isOnWaitlist,
    needsVerification: result.needsVerification,
    // Einlass-QR-Code als Data-URL, nur bei bestätigtem festen Platz auf einem Termin mit
    // aktivierter Einlasskontrolle - sonst null.
    checkinQrCode: result.qrCode
  })
}
