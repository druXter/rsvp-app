// app/lib/guest-form.ts
import type { Participant, Rsvp } from '@prisma/client'

// Was die Gästeseiten an das Antwort-Formular (RsvpForm, Client-Komponente) geben. Next.js schreibt die Props von
// Client-Komponenten vollständig in die Seite - eine ganze Zeile aus der Datenbank stünde samt verifyToken,
// guestUserId usw. im Quelltext (docs/AUDIT-2026-11.md, R-03). Deshalb nur diese Felder; braucht das Formular mehr,
// hier ergänzen und prüfen, dass es nichts ist, was der Gast nicht sehen darf. Rein, ohne Datenbank.

export type ParticipantForForm = Pick<Participant, 'name' | 'email' | 'phone' | 'dietaryOption' | 'allergies' | 'isVerified'> & {
  editToken?: string
}

export type RsvpForForm = Pick<Rsvp,
  'isAttending' | 'isMaybe' | 'isOnWaitlist' | 'drinksAlcohol' | 'additionalInfo' | 'bringingItem' | 'declineReason' |
  'customAnswers' | 'ticketCategoryId' | 'paidAt' | 'shiftHelperId' | 'shiftCount' | 'wichtelnOptOut'>

export function participantForForm(p: ParticipantForForm | null): ParticipantForForm | null {
  if (!p) return null
  return {
    name: p.name, email: p.email, phone: p.phone, dietaryOption: p.dietaryOption, allergies: p.allergies,
    isVerified: p.isVerified, ...(p.editToken ? { editToken: p.editToken } : {})
  }
}

export function rsvpForForm(r: RsvpForForm | null): RsvpForForm | null {
  if (!r) return null
  return {
    isAttending: r.isAttending, isMaybe: r.isMaybe, isOnWaitlist: r.isOnWaitlist, drinksAlcohol: r.drinksAlcohol,
    additionalInfo: r.additionalInfo, bringingItem: r.bringingItem, declineReason: r.declineReason,
    customAnswers: r.customAnswers, ticketCategoryId: r.ticketCategoryId, paidAt: r.paidAt,
    shiftHelperId: r.shiftHelperId, shiftCount: r.shiftCount, wichtelnOptOut: r.wichtelnOptOut
  }
}
