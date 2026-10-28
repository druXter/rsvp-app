// app/admin/manual-rsvp-actions.ts
'use server'

// Gäste von Hand eintragen (Reiter „Gäste“, app/lib/manual-rsvp.ts): für alle mit Zugriff auf die Gästeliste
// (Owner, Admin, Moderator*innen), wie das Bearbeiten einer Antwort. Es geht keine Mail raus - die Adresse gilt nur
// als bestätigt, wenn die Verwaltung den Haken setzt; sonst bestätigt der Gast sie über „erneut senden“.
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove } from '../lib/permissions'
import { formString } from '../lib/form'
import { InputError } from '../lib/input-error'
import { readManualRsvp } from '../lib/manual-rsvp'
import { defaultMaybeReminder, maybeAvailable } from '../lib/maybe'
import { generatePaymentReference, syncPaymentDue } from '../lib/payment'
import { savePersons } from '../lib/rsvp-submission'
import { notifyLinkedToolsOfRsvps } from '../lib/linked-tools-notify'
import type { SettingsState } from './actions'

export async function addManualRsvp(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const event = await prisma.event.findUnique({
    where: { id: formString(formData, 'eventId', 50) },
    include: { series: true, ticketCategories: true, _count: { select: { menuCourses: true } } }
  })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return { error: 'Termin nicht gefunden.' }

  try {
    const input = readManualRsvp(formData)
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

    const now = new Date()
    const participant = await prisma.participant.create({
      data: {
        name: input.name,
        seriesId: event.seriesId,
        email: input.email,
        isVerified: input.emailVerified,
        verifiedAt: input.emailVerified ? now : null
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
        paymentReference: amountCents ? generatePaymentReference(event.slug) : null
      }
    })
    // Mit Begleitungen oder Menü hat jede Antwort Personen (Begleitungen und Menü dann über „Bearbeiten“)
    if ((event.ticketCategories.length === 0 && event.maxCompanions > 0) || event._count.menuCourses > 0) {
      await savePersons(rsvp.id, [{ name: input.name, ageGroup: 'ADULT', isAttending, dietaryOption: null, allergies: null }])
    }
    if (amountCents) await syncPaymentDue({ rsvpIds: [rsvp.id] })
    notifyLinkedToolsOfRsvps([rsvp.id])
  } catch (error) {
    if (error instanceof InputError) return { error: error.message }
    throw error
  }

  revalidatePath('/admin', 'layout')
  redirect(`/admin/events/${event.id}/gaeste?eingetragen=1`)
}
