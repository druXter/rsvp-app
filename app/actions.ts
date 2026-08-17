// app/actions.ts
'use server' 

import { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { sendConfirmationEmail, sendVerificationEmail } from './lib/mail'

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

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event) throw new Error('Event nicht gefunden')

  // Wir laden den Altbestand VORHER aus der Datenbank
  let existingRsvp = null;
  if (editToken) {
    existingRsvp = await prisma.rsvp.findUnique({ where: { editToken } })
  }

  // Wenn die E-Mail bereits in der DB als verifiziert gilt, übernehmen wir stumpf die alte.
  // Andernfalls lesen wir die neue Eingabe aus dem Formular aus.
  const emailInput = formData.get('email') as string || null;
  const finalEmail = (existingRsvp && existingRsvp.isVerified && existingRsvp.email) 
    ? existingRsvp.email 
    : (isAttending ? emailInput : null);

  const data = {
    eventId,
    name,
    isAttending,
    email: finalEmail, // <-- Wir nutzen finalEmail
    phone: isAttending ? phone : null,
    dietaryOption: isAttending ? dietaryOption : null,
    drinksAlcohol: isAttending ? drinksAlcohol : null,
    additionalInfo: isAttending ? additionalInfo : null,
    plusOne: isAttending ? plusOne : false,
    plusOneName: isAttending && plusOne ? plusOneName : null,
    allergies: isAttending ? allergies : null,
    bringingItem: isAttending ? bringingItem : null,
    declineReason: isAttending ? null : declineReason
  }

  let savedRsvp;

  if (editToken) {
    savedRsvp = await prisma.rsvp.update({
      where: { editToken },
      data
    })
  } else {
    // FIX: Hier prüfen wir nun auf finalEmail statt auf email
    const needsVerification = event.requireVerification && isAttending && finalEmail !== null
    
    savedRsvp = await prisma.rsvp.create({
      data: {
        ...data,
        editToken: randomUUID(),
        isVerified: false, // Jeder startet als "nicht verifiziert"
        verifyToken: needsVerification ? randomUUID() : null
      }
    })
  }

  // E-Mail-Versand Logik
  if (savedRsvp.email && savedRsvp.isAttending) {
    try {
      if (!savedRsvp.isVerified && savedRsvp.verifyToken && !editToken) {
        await sendVerificationEmail(savedRsvp, event)
      } else if (!event.requireVerification && !editToken) {
        // Wenn keine Verifizierung nötig ist, geht die Bestätigung direkt raus
        await sendConfirmationEmail(savedRsvp, event)
      }
    } catch (error) {
      console.error("Fehler beim E-Mail-Versand:", error)
    }
  }

  revalidatePath(`/${eventId}`)
  revalidatePath('/admin') 
  
  // Wir geben dem Frontend zurück, ob der "Bitte Mails checken"-Screen gezeigt werden soll
  const requiresMailCheck = event.requireVerification && savedRsvp.isAttending && !savedRsvp.isVerified;

  return { 
    editToken: savedRsvp.editToken,
    needsVerification: requiresMailCheck 
  }
}