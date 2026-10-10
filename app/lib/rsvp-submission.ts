// app/lib/rsvp-submission.ts
import { PrismaClient, GuestUser } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { sendConfirmationEmail, sendVerificationEmail, sendWaitlistEmail } from './mail'
import { generateCheckinQrDataUrl } from './qrcode'
import { sendPushToUser, sendConfirmationPush } from './push'
import { notifyPollOfAttendanceChange } from './poll-notify'
import { notifyLinkedToolsOfRsvps } from './linked-tools-notify'
import { TOOL_LINKS } from './linked-tools-store'
import { isTimelineConfirmed, timelineLinkOf } from './timeline'
import { isSeatingConfirmed, seatingLinkOf } from './seating'
import { hasEventPinAccess } from './pin'
import { syncBringClaims } from './bring-list'
import { hasRoom, loadCapacity } from './tickets'
import { generatePaymentReference, paymentInfoOf, syncPaymentDue } from './payment'
import { fillFreeSeats, shouldSuppressConfirmationEmail } from './waitlist'
import { companionsOf, menuOf, seatsOf, type CompanionInput } from './persons'
import { courseOptions, isCompleteSelection, validSelection, type MenuSelection } from './menu'

const prisma = new PrismaClient()

/**
 * Eine abgegebene Antwort, unabhängig davon, ob sie aus dem Web-Formular (FormData, siehe
 * submitRsvp in app/actions.ts) oder von einem selbstgebauten Client über die Client-API
 * (app/api/v1/) stammt.
 */
export type RsvpSubmissionInput = {
  eventId: string
  editToken: string | null
  name: string
  isAttending: boolean
  phone?: string | null
  dietaryOption?: string | null
  allergies?: string | null
  emailInput?: string | null
  drinksAlcohol?: boolean | null
  additionalInfo?: string | null
  declineReason?: string | null
  /**
   * Begleitungen (app/lib/persons.ts, docs/KONZEPT-EINLADUNGEN.md). undefined = nicht gesendet (Formular ohne
   * Begleitungen, Client-API ohne Feld) - dann bleiben die bisherigen der Antwort.
   */
  companions?: CompanionInput[]
  /** Menüwahl der anmeldenden Person (app/lib/menu.ts). undefined = nicht gesendet, die bisherige bleibt. */
  menu?: MenuSelection
  bringingItem?: string | null
  customAnswers?: string[]
  /**
   * Angekreuzte Einträge der Mitbringliste (app/lib/bring-list.ts). undefined = die Liste wurde gar nicht
   * angezeigt bzw. gesendet (Client-API) - dann bleiben bestehende Beanspruchungen unangetastet.
   */
  bringSlotIds?: string[]
  /**
   * Gewählte Ticketkategorie (app/lib/tickets.ts). undefined = nicht gesendet (Formular ohne Kategorien,
   * Client-API ohne Feld) - dann gilt die bisherige Kategorie der Antwort.
   */
  ticketCategoryId?: string | null
  /**
   * NUR für die Client-API (app/api/v1/): Der Aufrufer ist dort per API-Token ein Mitglied der Reihe
   * (GuestUserSeries, wird vor dem Aufruf geprüft), das die Reihe über die PIN-geschützte Registrierung
   * bzw. durch einen Creator betreten hat. Das Web-Formular setzt das NIE.
   */
  skipPinCheck?: boolean
}

/**
 * Eingabefehler, die Gäste selbst beheben können (Kategorie fehlt oder ist ausgebucht). submitRsvp gibt die
 * Meldung als { error } ans Formular zurück, die Client-API als 400 - eine gewöhnliche Exception käme im
 * Produktivbetrieb nur als generische Fehlermeldung an.
 */
export class RsvpInputError extends Error {}

const ACCOUNT_REQUIRED_MESSAGE = 'Für dieses Event/diese Reihe ist ein Teilnehmendenkonto erforderlich. Bitte logge dich unter /mein-konto ein oder registriere dich zuerst.'

/**
 * Die eigentliche Antwort-Logik (Identität auflösen, Kapazität/Warteliste, Verifizierung,
 * E-Mails und Push) - EINMAL vorhanden, damit Web-Formular und Client-API sich niemals
 * auseinanderentwickeln können. Der Aufrufer reicht mit `guestUserCandidate` nur die von
 * IHM festgestellte Identität herein (Cookie-Session beim Formular, API-Token bei der
 * Client-API); ob sie überhaupt zum Zug kommt, entscheidet weiterhin ausschließlich diese
 * Funktion anhand derselben Bedingung wie vorher: nur ohne editToken und nur bei einem
 * Termin, der zu einer Reihe gehört. Deshalb darf ein Aufrufer die Identität auch niemals
 * aus vom Client geschickten Daten ableiten.
 */
export async function performRsvpSubmission(
  input: RsvpSubmissionInput,
  guestUserCandidate: GuestUser | null
) {
  const {
    eventId, editToken, name, isAttending,
    phone = null, dietaryOption = null, allergies = null, emailInput = null,
    drinksAlcohol = null, additionalInfo = null, declineReason = null,
    bringingItem = null
  } = input

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { series: true, toolLinks: TOOL_LINKS, ticketCategories: true, menuCourses: { orderBy: { position: 'asc' } } }
  })
  if (!event) throw new Error('Event nicht gefunden')

  // Die PIN wurde früher nur beim Rendern der Seite geprüft - jeder, der die Event-ID kannte, konnte
  // die Server Action direkt aufrufen und die PIN umgehen (siehe app/lib/pin.ts).
  if (!input.skipPinCheck && !(await hasEventPinAccess(event))) {
    throw new Error('Für dieses Event/diese Reihe ist ein Zugangscode erforderlich. Bitte öffne die Seite und gib ihn ein.')
  }

  // Ist der Termin Teil einer Reihe, gelten die Profil-/Zugangs-Einstellungen der Reihe
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const requireGuestUser = event.series ? event.series.requireGuestUser : event.requireGuestUser

  // Der Participant trägt die reihenweit (bzw. bei Einzel-Events: einmalig) geteilte Identität.
  // Ohne editToken wird bei einem Reihen-Termin zusätzlich versucht, die Identität über eine
  // eingeloggte Gast-Session (Nutzer-Konto, siehe #12) aufzulösen - so muss ein eingeloggter
  // Nutzer keinen Link mehr kennen, um seine reihenweite Identität wiederzufinden. Ist
  // requireGuestUser gesetzt, gilt das ausnahmsweise auch für ein Einzel-Event ohne Reihe,
  // da eine Anmeldung dort ausschließlich über ein Nutzer-Konto möglich sein soll.
  const guestUser = !editToken && (event.seriesId || requireGuestUser) ? guestUserCandidate : null

  // "Nur registrierte Teilnehmer"-Sperre: ohne editToken (also nicht über einen bereits
  // bestehenden persönlichen Link) MUSS eine eingeloggte Gast-Session vorliegen. Ein bereits
  // bestehender editToken bleibt bewusst immer gültig - er kann nur besitzen, wer den
  // Termin schon einmal (zwingend eingeloggt) beantwortet hat, bzw. bei einer nachträglich
  // umgestellten Reihe (siehe requireGuestUser-Kommentar in schema.prisma) schon vorher
  // anonym teilgenommen hat und diesen Zugang nicht verlieren soll.
  if (requireGuestUser && !editToken && !guestUser) {
    throw new Error(ACCOUNT_REQUIRED_MESSAGE)
  }

  const existingParticipant = editToken
    ? await prisma.participant.findUnique({ where: { editToken } })
    : guestUser
      ? await prisma.participant.findFirst({
          where: event.seriesId
            ? { seriesId: event.seriesId, guestUserId: guestUser.id }
            // Bei einem Einzel-Event gibt es keine reihenweite Identität - der Participant
            // dieses eingeloggten Kontos muss hier zusätzlich auf GENAU dieses Event
            // eingegrenzt werden, sonst würde fälschlich der Participant eines anderen
            // Einzel-Events desselben Kontos gefunden.
            : { guestUserId: guestUser.id, rsvps: { some: { eventId } } }
        })
      : null

  // Die Antwort zu GENAU DIESEM Termin - kann fehlen, auch wenn der Participant schon existiert
  // (z.B. wenn er über seinen Reihen-Link zum ersten Mal auf einen NEUEN Termin antwortet)
  const existingRsvp = existingParticipant
    ? await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId, participantId: existingParticipant.id } },
        include: { persons: { orderBy: { position: 'asc' }, include: { menuChoices: true } } }
      })
    : null

  // Ein editToken hebelt den Konto-Zwang nur aus, wenn er zu DIESEM Termin bzw. dieser Reihe
  // gehört (jemand, der hier schon vorher teilgenommen hat). Ohne diese Prüfung reichte ein
  // beliebiger nicht-leerer Wert - oder der Token eines ANDEREN, offenen Termins -, um die Sperre
  // zu umgehen, einen neuen Participant anzulegen und sich samt Einlass-QR-Code einzutragen.
  if (requireGuestUser && !guestUser) {
    const tokenBelongsHere = !!existingParticipant && (
      event.seriesId ? existingParticipant.seriesId === event.seriesId : !!existingRsvp
    )
    if (!tokenBelongsHere) throw new Error(ACCOUNT_REQUIRED_MESSAGE)
  }

  // Ticketkategorie (docs/KONZEPT-TICKETS.md): Pflicht für eine Zusage, sobald der Termin Kategorien hat. Nur
  // Kategorien DIESES Termins zählen. Eine Absage behält die bisherige (Erstattung, erneute Zusage).
  const categories = event.ticketCategories
  const previousCategoryId = existingRsvp?.ticketCategoryId ?? null
  let ticketCategoryId: string | null = previousCategoryId
  if (isAttending && categories.length > 0) {
    const requested = input.ticketCategoryId === undefined ? previousCategoryId : input.ticketCategoryId
    const category = categories.find(c => c.id === requested)
    if (!category) throw new RsvpInputError('Bitte wähle eine Ticketkategorie.')
    if (existingRsvp?.paidAt && previousCategoryId !== null && category.id !== previousCategoryId) {
      throw new RsvpInputError('Nach der Zahlung kann nur noch die Veranstaltung die Kategorie ändern.')
    }
    ticketCategoryId = category.id
  }
  // Betrag aus dem Preis der Kategorie - festgeschrieben, bis der Gast (vor der Zahlung) die Kategorie wechselt,
  // damit eine spätere Preisänderung nur neue Zusagen trifft. Der Verwendungszweck bleibt für immer derselbe.
  let amountCents = existingRsvp?.amountCents ?? null
  if (isAttending && ticketCategoryId && !existingRsvp?.paidAt && (ticketCategoryId !== previousCategoryId || amountCents === null)) {
    amountCents = categories.find(c => c.id === ticketCategoryId)!.priceCents
  }
  const paymentReference = existingRsvp?.paymentReference ?? (amountCents ? generatePaymentReference(event.slug) : null)

  // Einmal verifizierte E-Mails sind gesperrt (siehe rsvp-form.tsx: Feld wird readOnly).
  // Bei einer Absage behalten wir eine evtl. vorhandene (auch unverifizierte) E-Mail,
  // da sie bei Reihen für weitere Termine relevant bleibt. Fragt der Termin gar keine
  // E-Mail ab (askEmail aus), liefert das Formular kein emailInput - für einen
  // eingeloggten Nutzer ist seine bereits bekannte, ggf. verifizierte Adresse aus dem
  // zentralen Konto (guestUser.email) trotzdem die richtige Angabe, nicht "keine E-Mail".
  const finalEmail = (existingParticipant && existingParticipant.isVerified && existingParticipant.email)
    ? existingParticipant.email
    : (isAttending ? (emailInput || guestUser?.email || existingParticipant?.email || null) : (existingParticipant?.email ?? guestUser?.email ?? null))

  // Ein eingeloggter Nutzer (GuestUser), dessen Konto bereits verifiziert ist, hat seine
  // E-Mail-Adresse schon bei der Kontoregistrierung bestätigt - für ihn braucht es beim
  // ersten Termin einer NEUEN Reihe keine zusätzliche, redundante Double-Opt-In-Mail mehr.
  const guestAlreadyVerified = !!(guestUser && guestUser.isVerified)

  let needsVerification = false
  if (requireVerification && isAttending && finalEmail !== null && !guestAlreadyVerified) {
    if (!existingParticipant) {
      needsVerification = true
    } else if (existingParticipant.email !== finalEmail || !existingParticipant.isVerified) {
      needsVerification = true
    }
  }

  // Begleitungen (docs/KONZEPT-EINLADUNGEN.md): Mit Ticketkategorien meldet sich jede Person selbst an (Kategorie,
  // Betrag und Einlass pro Person). Hat die Verwaltung das Höchstmaß gesenkt, darf eine Antwort ihre bisherigen
  // behalten, aber keine hinzufügen. Ohne Feld bleiben die bisherigen. Eine Absage behält sie für eine erneute Zusage.
  const existingPersons = existingRsvp?.persons ?? []
  const existingCompanions = companionsOf(existingPersons)
  const maxCompanions = categories.length > 0 ? 0 : Math.max(event.maxCompanions, existingCompanions.length)
  const menu = event.menuCourses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) }))
  const usesPersons = maxCompanions > 0 || existingPersons.length > 0 || menu.length > 0
  const companions = input.companions ?? existingCompanions
  if (companions.length > maxCompanions) {
    throw new RsvpInputError(maxCompanions === 0 ? 'Für diesen Termin sind keine Begleitungen vorgesehen.' : `Höchstens ${maxCompanions} Begleitung${maxCompanions === 1 ? '' : 'en'} möglich.`)
  }
  // Menü (docs/KONZEPT-EINLADUNGEN.md): Bei einer Zusage wählt jede Person außer Kleinkindern pro Gang eine Option.
  // Gespeichert wird nur, was es im Menü dieses Termins gibt.
  const ownMenu = validSelection(menu, input.menu ?? (existingPersons[0] ? menuOf(existingPersons[0]) : {}))
  const companionRows = companions.map(c => ({ ...c, isAttending, menu: c.ageGroup === 'INFANT' ? {} : validSelection(menu, c.menu) }))
  if (isAttending && menu.length > 0) {
    const missing = [{ name, ageGroup: 'ADULT', menu: ownMenu }, ...companionRows].find(p => p.ageGroup !== 'INFANT' && !isCompleteSelection(menu, p.menu))
    if (missing) throw new RsvpInputError(`Bitte wähle das Menü für ${missing.name || 'alle Personen'} (jeder Gang).`)
  }
  const seats = usesPersons ? seatsOf([{ isAttending, ageGroup: 'ADULT' }, ...companionRows]) : 1
  const previousSeats = seatsOf(existingPersons)

  // Kapazitätsprüfung & Warteliste - ausschließlich pro Termin, Gesamtkapazität und Kontingent der Kategorie, Plätze
  // pro Person (hasRoom in app/lib/tickets.ts). Ein fester Platz bleibt, solange Kategorie gleich und Personen
  // nicht mehr werden; ein Wechsel in eine volle Kategorie oder zusätzliche Personen ohne Platz werden abgelehnt,
  // statt den Platz stillschweigend gegen die Warteliste zu tauschen.
  const wasFixed = !!existingRsvp && existingRsvp.isAttending && !existingRsvp.isOnWaitlist
  let isOnWaitlist = false
  if (isAttending && !(wasFixed && previousCategoryId === ticketCategoryId && seats <= previousSeats)) {
    const { limits, rsvps } = await loadCapacity(eventId)
    if (!hasRoom(limits, rsvps, ticketCategoryId, existingRsvp?.id, seats)) {
      if (wasFixed && previousCategoryId !== ticketCategoryId) {
        const label = categories.find(c => c.id === ticketCategoryId)?.label ?? ''
        throw new RsvpInputError(`Die Kategorie „${label}“ ist ausgebucht. Deine bisherige Anmeldung bleibt bestehen.`)
      }
      if (wasFixed) {
        throw new RsvpInputError(`Für ${seats} Personen ist leider kein Platz mehr frei. Deine bisherige Anmeldung bleibt bestehen.`)
      }
      isOnWaitlist = true
    }
  }

  // Verknüpfung zu einem Nutzer-Konto (GuestUser) bleibt erhalten, auch wenn gerade z.B.
  // über den alten editToken-Link geantwortet wird, ohne aktuell eingeloggt zu sein.
  const linkedGuestUserId = guestUser?.id ?? existingParticipant?.guestUserId ?? null

  // Participant-Profil anlegen/aktualisieren. Felder, die im Formular nicht vorkamen
  // (z.B. weil gerade abgesagt wird), überschreiben ein vorhandenes Profil NICHT mit null -
  // sie bleiben für andere Termine der Reihe erhalten.
  const participantData = {
    name,
    seriesId: event.seriesId,
    guestUserId: linkedGuestUserId,
    email: finalEmail,
    phone: phone ?? existingParticipant?.phone ?? null,
    dietaryOption: dietaryOption ?? existingParticipant?.dietaryOption ?? null,
    allergies: allergies ?? existingParticipant?.allergies ?? null,
  }

  let participant
  if (existingParticipant) {
    participant = await prisma.participant.update({
      where: { id: existingParticipant.id },
      data: {
        ...participantData,
        // Wenn eine Verifizierung nötig ist, setzen wir den Status sofort auf false zurück
        ...(needsVerification ? {
          isVerified: false,
          verifyToken: existingParticipant.verifyToken || randomUUID()
        } : {})
      }
    })
  } else {
    participant = await prisma.participant.create({
      data: {
        ...participantData,
        editToken: randomUUID(),
        // Ein bereits verifiziertes Nutzer-Konto vererbt seinen Verifizierungsstatus direkt
        // an den neuen Participant dieser Reihe (siehe guestAlreadyVerified oben) - sonst
        // würde die Kapazitäts-/Wartelisten-Logik ihn fälschlich als unverifiziert behandeln.
        isVerified: guestAlreadyVerified,
        verifiedAt: guestAlreadyVerified ? new Date() : null,
        verifyToken: needsVerification ? randomUUID() : null
      }
    })
  }

  // Zentrales Nutzer-Profil zurückspiegeln (gilt dann sofort für alle Reihen des Kontos)
  // und die Reihen-Mitgliedschaft sicherstellen, damit der Termin in "Mein Konto" auftaucht -
  // auch wenn noch niemand ihn dort explizit hinzugefügt hat.
  if (linkedGuestUserId) {
    await prisma.guestUser.update({
      where: { id: linkedGuestUserId },
      data: { name: participant.name, phone: participant.phone, dietaryOption: participant.dietaryOption, allergies: participant.allergies }
    })
  }
  if (guestUser && event.seriesId) {
    await prisma.guestUserSeries.upsert({
      where: { guestUserId_seriesId: { guestUserId: guestUser.id, seriesId: event.seriesId } },
      update: {},
      create: { guestUserId: guestUser.id, seriesId: event.seriesId }
    })
  }

  // Antworten auf die frei definierten Zusatzfragen (positionsbasiert, siehe formConfig.customQuestions)
  const customQuestions: string[] = event.formConfig ? (JSON.parse(event.formConfig).customQuestions || []) : []
  const customAnswers = isAttending && customQuestions.length > 0
    ? JSON.stringify(customQuestions.map((_, i) => input.customAnswers?.[i] || ''))
    : null

  const rsvpData = {
    isAttending,
    ticketCategoryId,
    amountCents,
    paymentReference,
    // Die Frist läuft ab dem festen Platz: Wer ihn behält, behält sie; sonst setzt syncPaymentDue eine neue
    // (z. B. erneute Zusage nach einer Stornierung wegen abgelaufener Frist)
    paymentDueAt: wasFixed && isAttending && !isOnWaitlist ? existingRsvp!.paymentDueAt : null,
    drinksAlcohol: isAttending ? drinksAlcohol : null,
    additionalInfo: isAttending ? additionalInfo : null,
    bringingItem: isAttending ? bringingItem : null,
    declineReason: isAttending ? null : declineReason,
    customAnswers,
    isOnWaitlist
  }

  let savedRsvp
  if (existingRsvp) {
    savedRsvp = await prisma.rsvp.update({
      where: { id: existingRsvp.id },
      data: rsvpData
    })
  } else {
    savedRsvp = await prisma.rsvp.create({
      data: {
        ...rsvpData,
        eventId,
        participantId: participant.id
      }
    })

    // Event-Owner per Push benachrichtigen (nur bei brandneuen Antworten, nicht bei Änderungen)
    try {
      await sendPushToUser(event.ownerId, {
        title: isAttending ? 'Neue Zusage 🎉' : 'Neue Absage',
        body: `${name}${companions.length > 0 ? ` (+${companions.length})` : ''} - ${event.title}`,
        url: '/admin'
      })
    } catch (error) {
      console.error("Fehler beim Push-Versand:", error)
    }
  }

  // Personen der Antwort: die anmeldende (Angaben vom Participant) und ihre Begleitungen, alle neu geschrieben
  if (usesPersons) {
    await savePersons(savedRsvp.id, [
      { name: participant.name, ageGroup: 'ADULT', isAttending, dietaryOption: participant.dietaryOption, allergies: participant.allergies, menu: ownMenu },
      ...companionRows
    ])
  }

  // Zahlfrist setzen bzw. entfernen, bevor die Bestätigung (mit Frist) verschickt wird
  if (amountCents) {
    await syncPaymentDue({ rsvpIds: [savedRsvp.id] })
    savedRsvp = await prisma.rsvp.findUniqueOrThrow({ where: { id: savedRsvp.id } })
  }

  // Mitbringliste: nur eine Zusage, die zählt (nicht auf der Warteliste), hält Einträge
  await syncBringClaims(savedRsvp.id, eventId, input.bringSlotIds, isAttending && !isOnWaitlist)

  // Nachrücken, wenn ein fester Platz frei wird: Absage, Wechsel der Kategorie oder weniger Personen
  // (app/lib/waitlist.ts, benachrichtigt Nachrücker und verknüpfte Tools selbst)
  if (wasFixed && (!isAttending || previousCategoryId !== ticketCategoryId || seats < previousSeats)) {
    await fillFreeSeats(eventId)
  }

  // Verknüpfte Abstimmung (falls vorhanden) über die neue Zu-/Absage informieren -
  // siehe poll-notify.ts. Läuft für jede Antwort (nicht nur neue), damit eine
  // nachträgliche Absage auch dann durchschlägt, wenn schon vorher geantwortet wurde.
  try {
    await notifyPollOfAttendanceChange(event, participant.email, savedRsvp.isAttending)
  } catch (error) {
    console.error("Fehler bei der Abstimmungs-Benachrichtigung:", error)
  }

  // Verknüpfte Tools (z.B. Seating) über die Änderung informieren. Läuft erst nach der Antwort (siehe
  // linked-tools-notify.ts); Nachrücker meldet fillFreeSeats selbst.
  notifyLinkedToolsOfRsvps([savedRsvp.id])

  // E-Mail Logik für den GAST
  if (participant.email && savedRsvp.isAttending) {
    try {
      if (needsVerification) {
        // Schickt die Verifizierungsmail auch bei einer neuen E-Mail-Adresse im Update-Fall
        await sendVerificationEmail(participant, event)
      } else if (participant.isVerified || !requireVerification) {

        const isNewFixed = !existingRsvp && !savedRsvp.isOnWaitlist
        const isNewWaitlist = !existingRsvp && savedRsvp.isOnWaitlist

        const changedFromDeclineToFixed = existingRsvp && !existingRsvp.isAttending && !savedRsvp.isOnWaitlist
        const changedFromDeclineToWaitlist = existingRsvp && !existingRsvp.isAttending && savedRsvp.isOnWaitlist

        // Wenn man durch das Update plötzlich in einen frei gewordenen Platz gerutscht ist
        const changedFromWaitlistToFixed = existingRsvp && existingRsvp.isOnWaitlist && !savedRsvp.isOnWaitlist

        if (isNewFixed || changedFromDeclineToFixed || changedFromWaitlistToFixed) {
          if (await shouldSuppressConfirmationEmail(participant)) {
            await sendConfirmationPush(event, participant)
          } else {
            await sendConfirmationEmail(participant, savedRsvp, event)
          }
        } else if (isNewWaitlist || changedFromDeclineToWaitlist) {
          await sendWaitlistEmail(participant, savedRsvp, event)
        }
      }
    } catch (error) {
      console.error("Fehler beim E-Mail-Versand:", error)
    }
  }

  revalidatePath(`/${event.slug}`)
  if (event.series) revalidatePath(`/reihe/${event.series.slug}`)
  revalidatePath('/admin')

  // Einlass-QR-Code für die Erfolgsseite - nur für einen bestätigten, festen Platz
  // und nur, wenn der Check-in für diesen Termin aktiviert ist
  const qrCode = event.enableCheckin && savedRsvp.isAttending && !savedRsvp.isOnWaitlist
    ? await generateCheckinQrDataUrl(savedRsvp.id)
    : null

  // "Sitzplatz wählen" auf der Erfolgsseite - nur für eine Zusage, die bei Seating zählt
  const canChooseSeat = !!seatingLinkOf(event) && isSeatingConfirmed(savedRsvp, participant, requireVerification, event.seatingRequiresPayment)
  // ...oder erst nach Zahlungseingang (Event.seatingRequiresPayment) - dann ein Hinweis statt des Knopfs
  const seatAfterPayment = !!seatingLinkOf(event) && !canChooseSeat && isSeatingConfirmed(savedRsvp, participant, requireVerification, false)
  // "Zeitplan" ebenso - nur für eine Zusage, die dort zählt
  const canOpenTimeline = !!timelineLinkOf(event) && isTimelineConfirmed(savedRsvp, participant, requireVerification)

  // Zahlungsdaten (Betrag, IBAN, Verwendungszweck, GiroCode) für die Erfolgsseite
  const payment = await paymentInfoOf({ ...savedRsvp, ticketCategory: categories.find(c => c.id === savedRsvp.ticketCategoryId) ?? null }, event)

  return {
    editToken: participant.editToken,
    payment,
    needsVerification,
    isOnWaitlist: savedRsvp.isOnWaitlist,
    qrCode,
    canChooseSeat,
    seatAfterPayment,
    canOpenTimeline
  }}

/**
 * Ersetzt die Personen einer Antwort (Position = Reihenfolge) samt Menüwahl. `menu` muss schon geprüft sein
 * (validSelection): nur Gänge dieses Termins.
 */
export async function savePersons(
  rsvpId: string,
  persons: readonly { name: string | null; ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null; menu?: MenuSelection }[]
) {
  await prisma.$transaction([
    prisma.rsvpPerson.deleteMany({ where: { rsvpId } }),
    ...persons.map(({ menu = {}, ...p }, position) => prisma.rsvpPerson.create({
      data: { rsvpId, position, ...p, menuChoices: { create: Object.entries(menu).map(([courseId, option]) => ({ courseId, option })) } }
    }))
  ])
}
