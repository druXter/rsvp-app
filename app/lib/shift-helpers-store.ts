// app/lib/shift-helpers-store.ts
import { randomUUID } from 'node:crypto'
import { prisma } from './prisma'
import { TOOL_LINKS } from './linked-tools-store'
import { generatePaymentReference, syncPaymentDue } from './payment'
import { savePersons } from './rsvp-submission'
import { sendConfirmationEmail } from './mail'
import { fillFreeSeats } from './waitlist'
import { notifyLinkedToolsOfRsvps } from './linked-tools-notify'
import { parseStoredTiers, shiftsLinkOf, tierFor, type ShiftHelpersMessage } from './shift-helpers'

/**
 * Datenbankseite der Helfer-Zusagen aus Schichten (Vertrag: app/lib/shift-helpers.ts, Endpunkt
 * app/api/shifts/helpers). Ein Termin wird nur verändert, wenn SEINE Verknüpfung mit Schichten auf genau das
 * meldende Schichten-Event zeigt (beide Seiten müssen eingetragen haben).
 *
 * Regeln (Schichten docs/KONZEPT.md Abschnitt 8):
 * - Wer eine Stufe erreicht, hat eine feste Zusage in deren Kategorie - Kapazität und Kontingente gelten nicht (wie
 *   „Zulassen“ von Hand), der Preis der Kategorie schon. Neue Zusagen bekommen die normale Bestätigungsmail.
 * - Wer unter die erste Stufe fällt (oder in der Meldung fehlt), bekommt eine Absage - außer die Zusage ist schon
 *   bezahlt oder eingelassen, dann bleibt sie (die Gästeliste zeigt „0 Schichten“).
 * - Hat dieselbe E-Mail-Adresse schon eine eigene Zusage im Termin, bleibt diese unangetastet; die Helfer*in kommt
 *   als Konflikt zurück an Schichten, die Verwaltung entscheidet.
 * - Bezahlte Zusagen wechseln die Kategorie nicht mehr (der Betrag ist festgeschrieben).
 */

export async function linkedShiftsEvent(message: ShiftHelpersMessage) {
  const event = await prisma.event.findUnique({
    where: { id: message.rsvpEventId },
    include: { series: true, toolLinks: TOOL_LINKS, ticketCategories: true, _count: { select: { menuCourses: true } } }
  })
  if (!event) return null
  const link = shiftsLinkOf(event)
  if (!link || link.remoteEventId !== message.shiftsEventId) return null
  return { event, link }
}

type Linked = NonNullable<Awaited<ReturnType<typeof linkedShiftsEvent>>>

export type ApplyResult = { outcome: 'applied' | 'stale'; conflicts: string[] }

export async function applyShiftHelpers({ event, link }: Linked, message: ShiftHelpersMessage): Promise<ApplyResult> {
  const tiers = parseStoredTiers(event.shiftTiers)
  const categories = new Map(event.ticketCategories.map(c => [c.id, c]))
  const usesPersons = event.maxCompanions > 0 || event._count.menuCourses > 0
  const where = { eventId_type: { eventId: event.id, type: 'shifts' } }
  const now = new Date()

  const result = await prisma.$transaction(async tx => {
    // Stand der Verknüpfung erst hier lesen: geändert oder entfernt = Meldung gilt nicht mehr; ältere Meldung = verwerfen
    const current = await tx.eventToolLink.findUnique({ where, select: { url: true, syncedAt: true } })
    if (!current || current.url !== link.url) return null
    if (current.syncedAt && message.seq <= current.syncedAt.getTime()) return null

    const existing = await tx.rsvp.findMany({ where: { eventId: event.id, shiftHelperId: { not: null } }, include: { participant: true } })
    const byHelper = new Map(existing.map(r => [r.shiftHelperId!, r]))
    const reported = new Map(message.helpers.map(h => [h.helperId, h]))
    const changed: string[] = []
    const newlyFixed: string[] = []
    const conflicts: string[] = []
    let freed = false

    // Nicht (mehr) gemeldet oder unter der ersten Stufe: Absage, außer bezahlt oder eingelassen
    for (const rsvp of existing) {
      const helper = reported.get(rsvp.shiftHelperId!)
      if (helper && tierFor(tiers, helper.shifts)) continue
      const keep = rsvp.paidAt !== null || rsvp.hasAttended
      const shiftCount = helper?.shifts ?? 0
      if (rsvp.isAttending && !keep) {
        await tx.rsvp.update({ where: { id: rsvp.id }, data: { isAttending: false, isOnWaitlist: false, shiftCount } })
        changed.push(rsvp.id)
        freed = true
      } else if (rsvp.shiftCount !== shiftCount) {
        await tx.rsvp.update({ where: { id: rsvp.id }, data: { shiftCount } })
      }
    }

    for (const helper of message.helpers) {
      const tier = tierFor(tiers, helper.shifts)
      if (!tier) continue
      const category = tier.categoryId ? categories.get(tier.categoryId) ?? null : null
      const amountCents = category && category.priceCents > 0 ? category.priceCents : null
      const rsvp = byHelper.get(helper.helperId)

      if (rsvp) {
        if (rsvp.participant.name !== helper.name || rsvp.participant.email !== helper.email) {
          await tx.participant.update({ where: { id: rsvp.participantId }, data: { name: helper.name, email: helper.email } })
        }
        const categoryChanges = !rsvp.paidAt && (category?.id ?? null) !== rsvp.ticketCategoryId
        await tx.rsvp.update({
          where: { id: rsvp.id },
          data: {
            shiftCount: helper.shifts,
            isAttending: true,
            isOnWaitlist: false,
            ...(categoryChanges ? {
              ticketCategoryId: category?.id ?? null,
              amountCents,
              paymentReference: amountCents ? rsvp.paymentReference ?? generatePaymentReference(event.slug) : rsvp.paymentReference
            } : {})
          }
        })
        if (!rsvp.isAttending || rsvp.isOnWaitlist) newlyFixed.push(rsvp.id)
        if (!rsvp.isAttending || rsvp.isOnWaitlist || categoryChanges) changed.push(rsvp.id)
        if (categoryChanges) freed = true
        continue
      }

      // Eigene Zusage derselben Adresse im Termin: nicht anfassen, als Konflikt melden
      const own = await tx.rsvp.findFirst({ where: { eventId: event.id, participant: { email: helper.email } }, select: { id: true } })
      if (own) {
        conflicts.push(helper.helperId)
        continue
      }
      const participant = await tx.participant.create({
        data: { name: helper.name, email: helper.email, seriesId: event.seriesId, editToken: randomUUID(), isVerified: true, verifiedAt: now }
      })
      const created = await tx.rsvp.create({
        data: {
          eventId: event.id, participantId: participant.id, isAttending: true, isOnWaitlist: false,
          ticketCategoryId: category?.id ?? null, amountCents, paymentReference: amountCents ? generatePaymentReference(event.slug) : null,
          shiftHelperId: helper.helperId, shiftCount: helper.shifts
        }
      })
      newlyFixed.push(created.id)
      changed.push(created.id)
    }

    await tx.eventToolLink.update({ where, data: { syncedAt: new Date(message.seq) } })
    return { changed, newlyFixed, conflicts, freed }
  })
  if (!result) return { outcome: 'stale', conflicts: [] }

  // Nach der Transaktion: Personen (bei Menü/Begleitungen), Zahlfrist, Bestätigungsmails, andere Tools, Nachrücken
  const fresh = await prisma.rsvp.findMany({ where: { id: { in: result.newlyFixed } }, include: { participant: true } })
  for (const rsvp of fresh) {
    if (usesPersons && (await prisma.rsvpPerson.count({ where: { rsvpId: rsvp.id } })) === 0) {
      await savePersons(rsvp.id, [{ name: rsvp.participant.name, ageGroup: 'ADULT', isAttending: true, dietaryOption: null, allergies: null }])
    }
  }
  const withAmount = fresh.filter(r => r.amountCents).map(r => r.id)
  if (withAmount.length > 0) await syncPaymentDue({ rsvpIds: withAmount })
  for (const rsvp of await prisma.rsvp.findMany({ where: { id: { in: result.newlyFixed } }, include: { participant: true } })) {
    if (!rsvp.participant.email) continue
    try {
      await sendConfirmationEmail(rsvp.participant, rsvp, event)
    } catch (error) {
      console.error('Fehler bei der Bestätigung einer Helfer-Zusage:', error)
    }
  }
  notifyLinkedToolsOfRsvps(result.changed)
  if (result.freed) await fillFreeSeats(event.id)
  return { outcome: 'applied', conflicts: result.conflicts }
}
