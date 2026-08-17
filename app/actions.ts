// app/actions.ts
'use server' 

import { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { sendConfirmationEmail, sendVerificationEmail, sendWaitlistPromotedEmail, sendWaitlistEmail } from './lib/mail'

const prisma = new PrismaClient()

export async function submitRsvp(formData: FormData) {
  const eventId = formData.get('eventId') as string
  const editToken = formData.get('editToken') as string || null 
  const name = formData.get('name') as string
  const isAttending = formData.get('isAttending') === 'true'
  
  const phone = formData.get('phone') as string || null
  const dietaryOption = formData.get('dietaryOption') as string || null
  const drinksAlcohol = formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null
  const additionalInfo = formData.get('additionalInfo') as string || null
  const declineReason = formData.get('declineReason') as string || null

  const plusOne = formData.get('plusOne') === 'true'
  const plusOneName = formData.get('plusOneName') as string || null
  const allergies = formData.get('allergies') as string || null
  const bringingItem = formData.get('bringingItem') as string || null

  const event = await prisma.event.findUnique({ 
    where: { id: eventId },
    include: { rsvps: true } 
  })
  if (!event) throw new Error('Event nicht gefunden')

  let existingRsvp = null;
  if (editToken) {
    existingRsvp = await prisma.rsvp.findUnique({ where: { editToken } })
  }

  const emailInput = formData.get('email') as string || null;
  const finalEmail = (existingRsvp && existingRsvp.verifiedAt && existingRsvp.email) 
    ? existingRsvp.email 
    : (isAttending ? emailInput : null);

  // NEU: Verifizierungs-Logik auch für nachträgliche E-Mail-Änderungen zwingend anwenden
  let needsVerification = false;
  if (event.requireVerification && isAttending && finalEmail !== null) {
    if (!existingRsvp) {
      needsVerification = true;
    } else {
      // Wenn es vorher keine E-Mail gab oder sie noch nicht verifiziert war
      if (existingRsvp.email !== finalEmail || !existingRsvp.isVerified) {
        needsVerification = true;
      }
    }
  }

  // Kapazitätsprüfung & Warteliste
  let isOnWaitlist = false;
  if (isAttending && event.maxCapacity !== null) {
    const currentAttendeesCount = event.rsvps.filter(r => 
      r.isAttending && !r.isOnWaitlist && r.editToken !== editToken
    ).length;

    if (existingRsvp && existingRsvp.isAttending && !existingRsvp.isOnWaitlist) {
      isOnWaitlist = false; // Behält seinen festen Platz
    } else {
      if (currentAttendeesCount >= event.maxCapacity) {
        isOnWaitlist = true;
      }
    }
  }

  const data = {
    eventId,
    name,
    isAttending,
    email: finalEmail,
    phone: isAttending ? phone : null,
    dietaryOption: isAttending ? dietaryOption : null,
    drinksAlcohol: isAttending ? drinksAlcohol : null,
    additionalInfo: isAttending ? additionalInfo : null,
    plusOne: isAttending ? plusOne : false,
    plusOneName: isAttending && plusOne ? plusOneName : null,
    allergies: isAttending ? allergies : null,
    bringingItem: isAttending ? bringingItem : null,
    declineReason: isAttending ? null : declineReason,
    isOnWaitlist
  }

  let savedRsvp;
  if (editToken) {
    savedRsvp = await prisma.rsvp.update({
      where: { editToken },
      data: {
        ...data,
        // Wenn eine Verifizierung nötig ist, setzen wir den Status sofort auf false zurück
        ...(needsVerification ? {
          isVerified: false,
          verifyToken: existingRsvp?.verifyToken || randomUUID()
        } : {})
      }
    })
  } else {
    savedRsvp = await prisma.rsvp.create({
      data: {
        ...data,
        editToken: randomUUID(),
        isVerified: false,
        verifyToken: needsVerification ? randomUUID() : null
      }
    })
  }

  // Nachrück-Automatik, wenn man von "Kommt" auf "Kommt nicht" wechselt
  if (existingRsvp && existingRsvp.isAttending && !existingRsvp.isOnWaitlist && !isAttending) {
    if (event.maxCapacity !== null) {
      const nextInLine = await prisma.rsvp.findFirst({
        where: { 
          eventId: eventId, 
          isAttending: true, 
          isOnWaitlist: true,
          ...(event.requireVerification ? { isVerified: true } : {})
        },
        orderBy: { createdAt: 'asc' }
      });

      if (nextInLine) {
        const promotedRsvp = await prisma.rsvp.update({
          where: { id: nextInLine.id },
          data: { isOnWaitlist: false }
        });
        if (promotedRsvp.email) {
          await sendWaitlistPromotedEmail(promotedRsvp, event);
          await sendConfirmationEmail(promotedRsvp, event); 
        }
      }
    }
  }

  // E-Mail Logik für den GAST
  if (savedRsvp.email && savedRsvp.isAttending) {
    try {
      if (needsVerification) {
        // Schickt nun korrekterweise die Verifizierungsmail auch bei Updates!
        await sendVerificationEmail(savedRsvp, event)
      } else if (savedRsvp.isVerified || !event.requireVerification) {
        
        const isNewFixed = !editToken && !savedRsvp.isOnWaitlist;
        const isNewWaitlist = !editToken && savedRsvp.isOnWaitlist;

        const changedFromDeclineToFixed = editToken && existingRsvp && !existingRsvp.isAttending && !savedRsvp.isOnWaitlist;
        const changedFromDeclineToWaitlist = editToken && existingRsvp && !existingRsvp.isAttending && savedRsvp.isOnWaitlist;
        
        // NEU: Wenn man durch das Update plötzlich in einen frei gewordenen Platz gerutscht ist
        const changedFromWaitlistToFixed = editToken && existingRsvp && existingRsvp.isOnWaitlist && !savedRsvp.isOnWaitlist;

        if (isNewFixed || changedFromDeclineToFixed || changedFromWaitlistToFixed) {
          await sendConfirmationEmail(savedRsvp, event)
        } else if (isNewWaitlist || changedFromDeclineToWaitlist) {
          await sendWaitlistEmail(savedRsvp, event)
        }
      }
    } catch (error) {
      console.error("Fehler beim E-Mail-Versand:", error)
    }
  }

  revalidatePath(`/${eventId}`)
  revalidatePath('/admin') 
  
  return { 
    editToken: savedRsvp.editToken,
    needsVerification,
    isOnWaitlist: savedRsvp.isOnWaitlist
  }
}