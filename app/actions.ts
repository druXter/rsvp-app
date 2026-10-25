// app/actions.ts
'use server'

import { type PushSubscriptionInput, validPushSubscription } from 'suite-kit/web'
import { powError, safeEqual } from 'suite-kit'
import { prisma } from './lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentGuestUser } from './lib/guest-auth'
import { performRsvpSubmission, RsvpInputError } from './lib/rsvp-submission'
import { cookies } from 'next/headers'
import { clientIp, pinRules, refund, reserve } from './lib/throttle'
import { notifyLinkedToolsBeforeDelete } from './lib/linked-tools-notify'
import { verifyParticipantByToken, type VerifiedRsvp } from './lib/participant-verification'
import { readCompanions } from './lib/persons'
import { readMenuSelection } from './lib/menu'
import { readHousehold } from './lib/invitations'
import { guestOfEvent, releaseWish, reserveWish } from './lib/wishlist-store'
import { parseEuro, WishInputError } from './lib/wishlist'


/**
 * Server Action des Web-Formulars. Übersetzt nur die FormData-Felder und stellt die
 * Identität aus der Gast-Session fest; die eigentliche Logik liegt in
 * performRsvpSubmission (app/lib/rsvp-submission.ts), die sich die Client-API teilt.
 * Die Identität stammt ausschließlich aus dem Session-Cookie - niemals aus einem Feld des
 * abgeschickten Formulars, das ein Angreifer selbst befüllen könnte.
 *
 * Neue Antworten ohne Konto verlangen die Lösung des Bot-Schutzes (ProofOfWork im Formular, suite-kit) - sie
 * belegen Plätze und lösen Mails aus. Änderungen per Bearbeitungs-Link und Antworten mit Konto nicht.
 */
export async function submitRsvp(formData: FormData) {
  const editToken = (formData.get('editToken') as string) || null
  const guestUser = editToken ? null : await getCurrentGuestUser()
  if (!editToken && !guestUser) {
    const bot = powError(formData)
    if (bot) return { error: bot }
  }

  try {
    return await performRsvpSubmission(
      {
        eventId: formData.get('eventId') as string,
        editToken,
        name: formData.get('name') as string,
        isAttending: formData.get('isAttending') === 'true',
        phone: formData.get('phone') as string || null,
        dietaryOption: formData.get('dietaryOption') as string || null,
        allergies: formData.get('allergies') as string || null,
        emailInput: formData.get('email') as string || null,
        drinksAlcohol: formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null,
        additionalInfo: formData.get('additionalInfo') as string || null,
        declineReason: formData.get('declineReason') as string || null,
        // Begleitungen (app/lib/persons.ts): nur wenn das Formular sie angezeigt hat
        companions: readCompanions(formData),
        // Menüwahl der anmeldenden Person (app/lib/menu.ts): nur wenn das Formular sie angezeigt hat
        menu: readMenuSelection(formData, 'menu_'),
        // Einladungsmodus: Zu-/Absage pro Person des Haushalts (app/lib/invitations.ts)
        household: readHousehold(formData),
        bringingItem: formData.get('bringingItem') as string || null,
        // Bis zu 3 frei definierbare Zusatzfragen, positionsbasiert (siehe readCustomQuestions)
        customAnswers: [0, 1, 2].map(i => (formData.get(`customAnswer_${i}`) as string) || ''),
        // Mitbringliste: nur wenn das Formular sie angezeigt hat (Markierungsfeld), sonst unangetastet
        bringSlotIds: formData.has('bringSlotsShown') ? formData.getAll('bringSlot').map(String) : undefined,
        // Ticketkategorie (app/lib/tickets.ts): nur wenn das Formular sie gesendet hat
        ticketCategoryId: formData.has('ticketCategoryId') ? String(formData.get('ticketCategoryId')) : undefined,
        // Wichteln (app/lib/wichteln.ts): nur wenn das Formular das Häkchen gezeigt hat; Häkchen weg = Opt-out
        wichtelnOptOut: formData.has('wichtelnShown') ? formData.get('wichtelnJoin') !== 'on' : undefined
      },
      guestUser
    )
  } catch (error) {
    // Fehler, die Gäste selbst beheben können, als Meldung zurück ans Formular
    if (error instanceof RsvpInputError) return { error: error.message }
    throw error
  }
}

/**
 * Überprüft die Event-PIN (Einzel-Event) oder die Reihen-PIN (Veranstaltungsreihe)
 * und setzt bei Erfolg ein Freischalt-Cookie.
 */
export async function verifyEventPin(formData: FormData) {
  const eventId = formData.get('eventId') as string || null
  const seriesId = formData.get('seriesId') as string || null
  const pin = formData.get('pin') as string
  const slug = formData.get('slug') as string

  const cookieStore = await cookies()

  // Drosselung VOR dem Vergleich (atomar reserviert, siehe app/lib/throttle.ts): PINs sind oft kurz und
  // ließen sich sonst in Minuten durchprobieren. Wer die PIN kennt, wird dadurch nicht behindert.
  const rules = pinRules(await clientIp(), (seriesId || eventId || 'unbekannt'))
  if (!(await reserve(rules))) {
    return { success: false, error: 'Zu viele Versuche. Bitte warte etwa 15 Minuten.' }
  }
  const matches = (expected: string | null | undefined) => !!expected && typeof pin === 'string' && safeEqual(pin, expected)

  if (seriesId) {
    const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
    if (series && matches(series.eventPin)) {
      await refund(rules[0])
      cookieStore.set(`series_pin_${seriesId}`, pin, { maxAge: 60 * 60 * 24 * 30, httpOnly: true })
      revalidatePath(`/reihe/${slug}`)
      return { success: true }
    }
    return { success: false, error: "Falscher Code. Bitte versuche es erneut." }
  }

  const event = await prisma.event.findUnique({ where: { id: eventId! } })
  if (event && matches(event.eventPin)) {
    await refund(rules[0])
    // Cookie für 30 Tage setzen.
    cookieStore.set(`event_pin_${eventId}`, pin, { maxAge: 60 * 60 * 24 * 30, httpOnly: true })

    // Seite neu laden, damit die Freischaltung greift
    revalidatePath(`/${slug}`)
    return { success: true }
  }

  return { success: false, error: "Falscher Code. Bitte versuche es erneut." }
}

/**
 * Löscht die gesamte, per editToken identifizierte Gast-Identität unwiderruflich -
 * Recht auf Löschung (Art. 17 DSGVO). Der Participant ist bei einer Reihe über ALLE
 * Termine hinweg geteilt, daher löscht dies auch alle anderen Antworten dieser Person
 * innerhalb derselben Reihe, nicht nur die zu diesem einen Termin (siehe RsvpForm/
 * DeleteMyDataButton, wo genau davor gewarnt wird). Ein evtl. verknüpftes Nutzer-Konto
 * (GuestUser) selbst bleibt unberührt - dessen vollständige Löschung läuft separat über
 * deleteGuestAccount in app/mein-konto/actions.ts.
 */
export async function deleteMyParticipantData(formData: FormData) {
  const editToken = formData.get('editToken') as string
  const eventId = formData.get('eventId') as string
  if (!editToken) return

  const participant = await prisma.participant.findUnique({ where: { editToken } })
  if (!participant) return

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } })

  await notifyLinkedToolsBeforeDelete({ participantId: participant.id })
  await prisma.rsvp.deleteMany({ where: { participantId: participant.id } })
  await prisma.participantPushSubscription.deleteMany({ where: { participantId: participant.id } })
  await prisma.participant.delete({ where: { id: participant.id } })

  revalidatePath('/admin', 'layout')

  if (event?.series) {
    redirect(`/reihe/${event.series.slug}/${event.slug}`)
  } else if (event) {
    redirect(`/${event.slug}`)
  }
  redirect('/')
}

/**
 * Speichert das Push-Abo eines Geräts für den per editToken identifizierten Participant
 * (siehe app/lib/push.ts, sendPushToParticipant). Anders als beim admin-seitigen
 * subscribeToPush braucht es hier keine Login-Session - der Besitz eines gültigen
 * editToken genügt als Autorisierung, genau wie bei deleteMyParticipantData oben. Wird
 * ein bereits bekannter Endpoint erneut abonniert, werden einfach die Keys aktualisiert
 * statt einen Duplikat-Eintrag anzulegen.
 */
export async function subscribeParticipantToPush(editToken: unknown, input: PushSubscriptionInput) {
  // Nur Push-Dienste der Browser-Hersteller: Der Server schickt später Anfragen an den Endpoint (SSRF-Schutz).
  const subscription = validPushSubscription(input)
  if (typeof editToken !== 'string' || !editToken || !subscription) return

  const participant = await prisma.participant.findUnique({ where: { editToken } })
  if (!participant) return

  await prisma.participantPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { p256dh: subscription.p256dh, auth: subscription.auth, participantId: participant.id },
    create: { ...subscription, participantId: participant.id }
  })
}

/**
 * Entfernt das Push-Abo eines Geräts wieder (Gast hat Benachrichtigungen deaktiviert).
 */
export async function unsubscribeParticipantFromPush(editToken: string, endpoint: string) {
  if (!editToken) return

  const participant = await prisma.participant.findUnique({ where: { editToken } })
  if (!participant) return

  await prisma.participantPushSubscription.deleteMany({ where: { endpoint, participantId: participant.id } })
}

export type ParticipantVerificationState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'done'; editToken: string; results: VerifiedRsvp[] }

/**
 * "Jetzt bestätigen" auf /verify (Double-Opt-In einer Zusage). Der Mail-Link selbst ändert
 * nichts mehr - erst dieser Klick, weil Link-Scanner von Mail-Anbietern Links automatisch
 * abrufen (siehe app/lib/participant-verification.ts). Berechtigt ist, wer den Token aus der
 * Mail kennt; als useActionState-Action, damit die Seite das Ergebnis ohne Token in einer
 * weiteren URL anzeigen kann.
 */
export async function confirmParticipantVerification(
  _previous: ParticipantVerificationState, formData: FormData
): Promise<ParticipantVerificationState> {
  const token = formData.get('token')
  const outcome = typeof token === 'string' ? await verifyParticipantByToken(token) : null
  return outcome ? { status: 'done', ...outcome } : { status: 'invalid' }
}

export type WishActionState = { error?: string; ok?: string } | null

/**
 * Wunschliste (docs/KONZEPT-WUNSCHLISTE.md): Geschenk reservieren bzw. sich an einem Geldwunsch beteiligen, oder
 * die eigene Reservierung aufheben (mode=release). Identität nur über den persönlichen Link (editToken) eines Gasts
 * mit Antwort oder Einladung zu diesem Termin (guestOfEvent) - nie über Felder, die jemand frei befüllen könnte.
 */
export async function updateWishReservation(_prev: WishActionState, formData: FormData): Promise<WishActionState> {
  const editToken = String(formData.get('editToken') ?? '')
  const eventId = String(formData.get('eventId') ?? '')
  const wishId = String(formData.get('wishId') ?? '')
  const guest = editToken && eventId ? await guestOfEvent(editToken, eventId) : null
  if (!guest) return { error: 'Reservieren geht nur über deinen persönlichen Link, nachdem du geantwortet hast.' }
  try {
    if (formData.get('mode') === 'release') {
      await releaseWish(wishId, guest.participantId)
    } else {
      const amount = formData.has('amount') ? parseEuro(String(formData.get('amount')), 'Betrag') : null
      await reserveWish(wishId, eventId, guest.participantId, {
        quantity: formData.has('quantity') ? Number(formData.get('quantity')) : undefined,
        amountCents: amount ?? undefined
      })
    }
  } catch (error) {
    if (error instanceof WishInputError) return { error: error.message }
    throw error
  }
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { slug: true, series: { select: { slug: true } } } })
  revalidatePath(event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`)
  revalidatePath('/admin', 'layout')
  return { ok: formData.get('mode') === 'release' ? 'Reservierung aufgehoben.' : 'Danke! Reserviert.' }
}
