// app/lib/rsvp-submission.ts
import { PrismaClient, GuestUser } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { sendConfirmationEmail, sendVerificationEmail, sendWaitlistPromotedEmail, sendWaitlistEmail } from './mail'
import { generateCheckinQrDataUrl } from './qrcode'
import { sendPushToUser, sendConfirmationPush } from './push'
import { notifyPollOfAttendanceChange } from './poll-notify'
import { hasEventPinAccess } from './pin'

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
  plusOne?: boolean
  plusOneName?: string | null
  bringingItem?: string | null
  customAnswers?: string[]
  /**
   * NUR für die Client-API (app/api/v1/): Der Aufrufer ist dort per API-Token ein Mitglied der Reihe
   * (GuestUserSeries, wird vor dem Aufruf geprüft), das die Reihe über die PIN-geschützte Registrierung
   * bzw. durch einen Creator betreten hat. Das Web-Formular setzt das NIE.
   */
  skipPinCheck?: boolean
}

/**
 * Ob statt der Bestätigungs-Mail eine Push-Benachrichtigung (sendConfirmationPush) gehen
 * soll - der Gast hat das in seinem Nutzer-Konto so eingestellt (GuestUser.disableConfirmationEmails,
 * siehe /mein-konto/account), weil ihm die Info ohnehin per PWA-Push angezeigt wird. Betrifft
 * nur die Bestätigungs-Mail; anonyme editToken-Gäste ohne Konto (guestUserId null) bekommen
 * sie unverändert immer.
 */
async function shouldSuppressConfirmationEmail(participant: { guestUserId: string | null }) {
  if (!participant.guestUserId) return false
  const guestUser = await prisma.guestUser.findUnique({
    where: { id: participant.guestUserId },
    select: { disableConfirmationEmails: true }
  })
  return guestUser?.disableConfirmationEmails ?? false
}

const ACCOUNT_REQUIRED_MESSAGE = 'Für dieses Event/diese Reihe ist ein Nutzer-Konto erforderlich. Bitte logge dich unter /mein-konto ein oder registriere dich zuerst.'

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
    plusOne = false, plusOneName = null, bringingItem = null
  } = input

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true, series: true }
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
        where: { eventId_participantId: { eventId, participantId: existingParticipant.id } }
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

  // Kapazitätsprüfung & Warteliste - weiterhin ausschließlich pro Termin
  let isOnWaitlist = false
  if (isAttending && event.maxCapacity !== null) {
    const currentAttendeesCount = event.rsvps.filter(r =>
      r.isAttending && !r.isOnWaitlist && r.participantId !== existingParticipant?.id
    ).length

    if (existingRsvp && existingRsvp.isAttending && !existingRsvp.isOnWaitlist) {
      isOnWaitlist = false // Behält seinen festen Platz
    } else if (currentAttendeesCount >= event.maxCapacity) {
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
    drinksAlcohol: isAttending ? drinksAlcohol : null,
    additionalInfo: isAttending ? additionalInfo : null,
    plusOne: isAttending ? plusOne : false,
    plusOneName: isAttending && plusOne ? plusOneName : null,
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
        body: `${name} - ${event.title}`,
        url: '/admin'
      })
    } catch (error) {
      console.error("Fehler beim Push-Versand:", error)
    }
  }

  // Nachrück-Automatik, wenn man von "Kommt" auf "Kommt nicht" wechselt
  if (existingRsvp && existingRsvp.isAttending && !existingRsvp.isOnWaitlist && !isAttending) {
    if (event.maxCapacity !== null) {
      const nextInLine = await prisma.rsvp.findFirst({
        where: {
          eventId,
          isAttending: true,
          isOnWaitlist: true,
          ...(requireVerification ? { participant: { isVerified: true } } : {})
        },
        orderBy: { createdAt: 'asc' },
        include: { participant: true }
      })

      if (nextInLine) {
        const promotedRsvp = await prisma.rsvp.update({
          where: { id: nextInLine.id },
          data: { isOnWaitlist: false }
        })
        if (nextInLine.participant.email) {
          // Fehlgeschlagener Versand (z.B. unzustellbare Adresse des Nachrückers) darf die
          // Absage der absagenden Person nicht scheitern lassen - gespeichert und
          // nachgerückt ist zu diesem Zeitpunkt bereits alles. Gleiche Behandlung wie beim
          // Gast-Mailversand weiter unten.
          try {
            await sendWaitlistPromotedEmail(nextInLine.participant, promotedRsvp, event)
            if (await shouldSuppressConfirmationEmail(nextInLine.participant)) {
              await sendConfirmationPush(event, nextInLine.participant)
            } else {
              await sendConfirmationEmail(nextInLine.participant, promotedRsvp, event)
            }
          } catch (error) {
            console.error("Fehler beim Nachrücker-Mailversand:", error)
          }
        }
      }
    }
  }

  // Verknüpfte Abstimmung (falls vorhanden) über die neue Zu-/Absage informieren -
  // siehe poll-notify.ts. Läuft für jede Antwort (nicht nur neue), damit eine
  // nachträgliche Absage auch dann durchschlägt, wenn schon vorher geantwortet wurde.
  try {
    await notifyPollOfAttendanceChange(event, participant.email, savedRsvp.isAttending)
  } catch (error) {
    console.error("Fehler bei der Abstimmungs-Benachrichtigung:", error)
  }

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

  return {
    editToken: participant.editToken,
    needsVerification,
    isOnWaitlist: savedRsvp.isOnWaitlist,
    qrCode
  }}
