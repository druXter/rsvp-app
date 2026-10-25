// app/api/v1/termine/[eventId]/antwort/route.ts
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../../../../lib/prisma'
import { getGuestUserFromApiToken, apiError } from '../../../../../lib/api-auth'
import { performRsvpSubmission, RsvpInputError } from '../../../../../lib/rsvp-submission'
import { cleanCompanion, cleanSelection, MAX_COMPANIONS, type CompanionInput } from '../../../../../lib/persons'

const MAX_BODY = 100_000


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
    const parsed: unknown = JSON.parse((await readLimitedText(request, MAX_BODY)) ?? '')
    // `null`, Zahlen oder Arrays sind gültiges JSON, aber keine Antwort - sonst endete body.isAttending in einer 500.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('kein Objekt')
    body = parsed as Record<string, unknown>
  } catch {
    return apiError(400, 'Body muss ein JSON-Objekt sein (höchstens 100 kB)')
  }

  if (typeof body.isAttending !== 'boolean') {
    return apiError(400, 'Feld "isAttending" (true/false) fehlt')
  }
  // „Vielleicht“ (app/lib/maybe.ts): isAttending false, maybe true und ein Erinnerungszeitpunkt (ISO 8601)
  const isMaybe = !body.isAttending && body.maybe === true
  const maybeRemindAt = isMaybe && typeof body.maybeRemindAt === 'string' ? new Date(body.maybeRemindAt) : null

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

  let result
  try {
    result = await performRsvpSubmission(
      {
        eventId,
        editToken: null,
        skipPinCheck: true, // Mitgliedschaft (GuestUserSeries) wurde oben geprüft
        name: guestUser.name,
        isAttending: body.isAttending,
        isMaybe,
        maybeRemindAt,
        phone: guestUser.phone,
        dietaryOption: guestUser.dietaryOption,
        allergies: guestUser.allergies,
        emailInput: guestUser.email,
        drinksAlcohol: typeof body.drinksAlcohol === 'boolean' ? body.drinksAlcohol : null,
        additionalInfo: typeof body.additionalInfo === 'string' ? body.additionalInfo : null,
        declineReason: typeof body.declineReason === 'string' ? body.declineReason : null,
        companions: readApiCompanions(body),
        // Menüwahl (Gang-ID -> Option), ohne Feld bleibt die bisherige
        menu: body.menu !== undefined ? cleanSelection(body.menu) : undefined,
        bringingItem: typeof body.bringingItem === 'string' ? body.bringingItem : null,
        customAnswers,
        // Ticketkategorie (app/lib/tickets.ts) - ohne Feld gilt die bisherige der Antwort
        ticketCategoryId: typeof body.ticketCategoryId === 'string' ? body.ticketCategoryId : undefined
      },
      guestUser
    )
  } catch (error) {
    if (error instanceof RsvpInputError) return apiError(400, error.message)
    throw error
  }

  return Response.json({
    isAttending: body.isAttending,
    maybe: result.isMaybe,
    // Erinnerung bei „Vielleicht“ (auf die volle Stunde abgerundet), sonst null
    maybeRemindAt: result.maybeRemindAt,
    isOnWaitlist: result.isOnWaitlist,
    needsVerification: result.needsVerification,
    // Einlass-QR-Code als Data-URL, nur bei bestätigtem festen Platz auf einem Termin mit
    // aktivierter Einlasskontrolle - sonst null.
    checkinQrCode: result.qrCode,
    // Zahlungsdaten (Betrag, IBAN, Verwendungszweck, GiroCode als Data-URL), falls etwas zu zahlen ist - sonst null
    payment: result.payment
  })
}

/**
 * Begleitungen aus dem Body: `companions` als Liste `[{name, ageGroup, dietaryOption, allergies, menu}]`, oder wie
 * früher `plusOne`/`plusOneName` als Kurzform für genau eine. Ohne beide Felder bleiben die bisherigen.
 * Einträge ohne Namen zählen nicht; mehr als erlaubt lehnt performRsvpSubmission ab.
 */
function readApiCompanions(body: Record<string, unknown>): CompanionInput[] | undefined {
  if (Array.isArray(body.companions)) {
    return body.companions
      .slice(0, MAX_COMPANIONS + 1)
      .map(c => (c && typeof c === 'object' ? cleanCompanion(c as Record<string, unknown>) : null))
      .filter((c): c is CompanionInput => c !== null)
  }
  if (typeof body.plusOne === 'boolean') {
    const companion = body.plusOne ? cleanCompanion({ name: body.plusOneName || 'Begleitung' }) : null
    return companion ? [companion] : []
  }
  return undefined
}
