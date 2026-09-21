// app/actions.ts
'use server'

import { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentGuestUser } from './lib/guest-auth'
import { performRsvpSubmission } from './lib/rsvp-submission'
import { cookies } from 'next/headers'
import { clientIp, pinRules, refund, reserve } from './lib/throttle'
import { safeEqual } from './lib/tokens'

const prisma = new PrismaClient()

/**
 * Server Action des Web-Formulars. Übersetzt nur die FormData-Felder und stellt die
 * Identität aus der Gast-Session fest; die eigentliche Logik liegt in
 * performRsvpSubmission (app/lib/rsvp-submission.ts), die sich die Client-API teilt.
 * Die Identität stammt ausschließlich aus dem Session-Cookie - niemals aus einem Feld des
 * abgeschickten Formulars, das ein Angreifer selbst befüllen könnte.
 */
export async function submitRsvp(formData: FormData) {
  const editToken = (formData.get('editToken') as string) || null

  return performRsvpSubmission(
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
      plusOne: formData.get('plusOne') === 'true',
      plusOneName: formData.get('plusOneName') as string || null,
      bringingItem: formData.get('bringingItem') as string || null,
      // Bis zu 3 frei definierbare Zusatzfragen, positionsbasiert (siehe readCustomQuestions)
      customAnswers: [0, 1, 2].map(i => (formData.get(`customAnswer_${i}`) as string) || '')
    },
    editToken ? null : await getCurrentGuestUser()
  )
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

  await prisma.rsvp.deleteMany({ where: { participantId: participant.id } })
  await prisma.participantPushSubscription.deleteMany({ where: { participantId: participant.id } })
  await prisma.participant.delete({ where: { id: participant.id } })

  revalidatePath('/admin')

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
export async function subscribeParticipantToPush(
  editToken: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  if (!editToken) return

  const participant = await prisma.participant.findUnique({ where: { editToken } })
  if (!participant) return

  await prisma.participantPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, participantId: participant.id },
    create: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, participantId: participant.id }
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
