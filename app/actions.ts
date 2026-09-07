// app/actions.ts
'use server'

import { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { sendConfirmationEmail, sendVerificationEmail, sendWaitlistPromotedEmail, sendWaitlistEmail } from './lib/mail'
import { generateCheckinQrDataUrl } from './lib/qrcode'
import { cookies } from 'next/headers'

const prisma = new PrismaClient()

export async function submitRsvp(formData: FormData) {
  const eventId = formData.get('eventId') as string
  const editToken = (formData.get('editToken') as string) || null
  const name = formData.get('name') as string
  const isAttending = formData.get('isAttending') === 'true'

  const phone = formData.get('phone') as string || null
  const dietaryOption = formData.get('dietaryOption') as string || null
  const allergies = formData.get('allergies') as string || null
  const emailInput = formData.get('email') as string || null

  const drinksAlcohol = formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null
  const additionalInfo = formData.get('additionalInfo') as string || null
  const declineReason = formData.get('declineReason') as string || null

  const plusOne = formData.get('plusOne') === 'true'
  const plusOneName = formData.get('plusOneName') as string || null
  const bringingItem = formData.get('bringingItem') as string || null

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true, series: true }
  })
  if (!event) throw new Error('Event nicht gefunden')

  // Ist der Termin Teil einer Reihe, gelten die Profil-/Zugangs-Einstellungen der Reihe
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

  // Der Participant trägt die reihenweit (bzw. bei Einzel-Events: einmalig) geteilte Identität
  const existingParticipant = editToken
    ? await prisma.participant.findUnique({ where: { editToken } })
    : null

  // Die Antwort zu GENAU DIESEM Termin - kann fehlen, auch wenn der Participant schon existiert
  // (z.B. wenn er über seinen Reihen-Link zum ersten Mal auf einen NEUEN Termin antwortet)
  const existingRsvp = existingParticipant
    ? await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId, participantId: existingParticipant.id } }
      })
    : null

  // Einmal verifizierte E-Mails sind gesperrt (siehe rsvp-form.tsx: Feld wird readOnly).
  // Bei einer Absage behalten wir eine evtl. vorhandene (auch unverifizierte) E-Mail,
  // da sie bei Reihen für weitere Termine relevant bleibt.
  const finalEmail = (existingParticipant && existingParticipant.isVerified && existingParticipant.email)
    ? existingParticipant.email
    : (isAttending ? emailInput : (existingParticipant?.email ?? null))

  let needsVerification = false
  if (requireVerification && isAttending && finalEmail !== null) {
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

  // Participant-Profil anlegen/aktualisieren. Felder, die im Formular nicht vorkamen
  // (z.B. weil gerade abgesagt wird), überschreiben ein vorhandenes Profil NICHT mit null -
  // sie bleiben für andere Termine der Reihe erhalten.
  const participantData = {
    name,
    seriesId: event.seriesId,
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
        isVerified: false,
        verifyToken: needsVerification ? randomUUID() : null
      }
    })
  }

  const rsvpData = {
    isAttending,
    drinksAlcohol: isAttending ? drinksAlcohol : null,
    additionalInfo: isAttending ? additionalInfo : null,
    plusOne: isAttending ? plusOne : false,
    plusOneName: isAttending && plusOne ? plusOneName : null,
    bringingItem: isAttending ? bringingItem : null,
    declineReason: isAttending ? null : declineReason,
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
          await sendWaitlistPromotedEmail(nextInLine.participant, promotedRsvp, event)
          await sendConfirmationEmail(nextInLine.participant, promotedRsvp, event)
        }
      }
    }
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
          await sendConfirmationEmail(participant, savedRsvp, event)
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

  if (seriesId) {
    const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
    if (series && series.eventPin === pin) {
      cookieStore.set(`series_pin_${seriesId}`, pin, { maxAge: 60 * 60 * 24 * 30, httpOnly: true })
      revalidatePath(`/reihe/${slug}`)
      return { success: true }
    }
    return { success: false, error: "Falscher Code. Bitte versuche es erneut." }
  }

  const event = await prisma.event.findUnique({ where: { id: eventId! } })
  if (event && event.eventPin === pin) {
    // Cookie für 30 Tage setzen.
    cookieStore.set(`event_pin_${eventId}`, pin, { maxAge: 60 * 60 * 24 * 30, httpOnly: true })

    // Seite neu laden, damit die Freischaltung greift
    revalidatePath(`/${slug}`)
    return { success: true }
  }

  return { success: false, error: "Falscher Code. Bitte versuche es erneut." }
}
