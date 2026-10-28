// app/admin/manual-rsvp-actions.ts
'use server'

// Gäste von Hand eintragen (Reiter „Gäste“, app/lib/manual-rsvp.ts): für alle mit Zugriff auf die Gästeliste
// (Owner, Admin, Moderator*innen), wie das Bearbeiten einer Antwort. Die Adresse gilt nur als bestätigt, wenn die
// Verwaltung den Haken setzt; sonst bestätigt der Gast sie über den Link aus der Mail. Eine Mail geht nur auf Wunsch
// raus (manualMailOf), z. B. für Kalenderdatei und Einlass-QR-Code nach einer telefonischen Zusage.
import { randomUUID } from 'crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove } from '../lib/permissions'
import { formString } from '../lib/form'
import { InputError } from '../lib/input-error'
import { manualMailOf, readManualRsvp, type ManualMail } from '../lib/manual-rsvp'
import { sendConfirmationEmail, sendMaybeVerificationEmail, sendVerificationEmail } from '../lib/mail'
import { defaultMaybeReminder, maybeAvailable } from '../lib/maybe'
import { generatePaymentReference, syncPaymentDue } from '../lib/payment'
import { savePersons } from '../lib/rsvp-submission'
import { readRsvpNote } from '../lib/rsvp-note'
import { notifyLinkedToolsOfRsvps } from '../lib/linked-tools-notify'
import type { SettingsState } from './actions'

export async function addManualRsvp(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const event = await prisma.event.findUnique({
    where: { id: formString(formData, 'eventId', 50) },
    include: { series: true, ticketCategories: true, _count: { select: { menuCourses: true } } }
  })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return { error: 'Termin nicht gefunden.' }
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

  let mail: ManualMail = null
  let mailSent = false
  try {
    const input = readManualRsvp(formData)
    const note = readRsvpNote(formData)
    if (event.inviteOnly) throw new InputError('Im Einladungsmodus kommen Gäste über Einladungen dazu.')
    const isAttending = input.status === 'yes'
    const isMaybe = input.status === 'maybe'
    if (isMaybe && !maybeAvailable(event)) throw new InputError('„Vielleicht“ ist für diesen Termin nicht (mehr) möglich.')

    // Zusage mit Ticketkategorien: eine Kategorie DIESES Termins, Betrag aus ihrem Preis (wie beim Gast)
    const category = isAttending && event.ticketCategories.length > 0 ? event.ticketCategories.find(c => c.id === input.ticketCategoryId) : null
    if (isAttending && event.ticketCategories.length > 0 && !category) throw new InputError('Bitte eine Ticketkategorie wählen.')
    const amountCents = category ? category.priceCents : null

    // Eine Adresse antwortet pro Termin nur einmal - sonst bekäme dieselbe Person doppelte Mails und Plätze
    if (input.email) {
      const taken = await prisma.rsvp.findMany({ where: { eventId: event.id, participant: { email: { not: null } } }, select: { participant: { select: { email: true } } } })
      if (taken.some(r => r.participant.email!.trim().toLowerCase() === input.email)) {
        throw new InputError(`Für ${input.email} gibt es schon eine Antwort - bitte dort bearbeiten.`)
      }
    }

    mail = manualMailOf(input, requireVerification)
    const now = new Date()
    const participant = await prisma.participant.create({
      data: {
        name: input.name,
        seriesId: event.seriesId,
        email: input.email,
        isVerified: input.emailVerified,
        verifiedAt: input.emailVerified ? now : null,
        // Der Link der Bitte um Bestätigung (/verify) - der Klick bestätigt auch die Zusage (participant-verification.ts)
        verifyToken: mail === 'verification' || mail === 'maybe-verification' ? randomUUID() : null
      }
    })
    // Kein Kontingent (wie „Zulassen“): Die Verwaltung trägt eine feste Zusage ein
    const rsvp = await prisma.rsvp.create({
      data: {
        eventId: event.id,
        participantId: participant.id,
        isAttending,
        isMaybe,
        // Invariante aus app/lib/maybe-store.ts: gesetzt genau dann, wenn etwas auf vielleicht steht. Erinnert wird
        // nur eine bestätigte Adresse, am Stichtag wird es zur Absage.
        maybeRemindAt: isMaybe ? defaultMaybeReminder(event, now) : null,
        ticketCategoryId: category?.id ?? null,
        amountCents,
        paymentReference: amountCents ? generatePaymentReference(event.slug) : null,
        // Interne Notiz ("telefonisch zugesagt") - nur für die Verwaltung (app/lib/rsvp-note.ts)
        ...(note ? { note: { create: { text: note } } } : {})
      }
    })
    // Mit Begleitungen oder Menü hat jede Antwort Personen (Begleitungen und Menü dann über „Bearbeiten“)
    if ((event.ticketCategories.length === 0 && event.maxCompanions > 0) || event._count.menuCourses > 0) {
      await savePersons(rsvp.id, [{ name: input.name, ageGroup: 'ADULT', isAttending, dietaryOption: null, allergies: null }])
    }
    if (amountCents) await syncPaymentDue({ rsvpIds: [rsvp.id] })
    notifyLinkedToolsOfRsvps([rsvp.id])

    // Mail erst, wenn alles gespeichert ist (Zahlfrist steht); ein Fehler beim Versand macht das Eintragen nicht rückgängig
    if (mail) {
      try {
        const saved = await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvp.id } })
        if (mail === 'confirmation') {
          await sendConfirmationEmail(participant, saved, event)
          mailSent = true
        } else if (mail === 'verification') {
          mailSent = await sendVerificationEmail(participant, event)
        } else {
          mailSent = await sendMaybeVerificationEmail(participant, event, saved.maybeRemindAt!)
        }
      } catch (error) {
        console.error('Fehler beim Versand nach dem Eintragen:', error)
      }
    }
  } catch (error) {
    if (error instanceof InputError) return { error: error.message }
    throw error
  }

  revalidatePath('/admin', 'layout')
  const result = !mail ? '1' : !mailSent ? 'mailfehler' : mail === 'confirmation' ? 'bestaetigung' : 'verifizierung'
  redirect(`/admin/events/${event.id}/gaeste?eingetragen=${result}`)
}
