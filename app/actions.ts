// app/actions.ts
'use server' // Deklariert alle exportierten Funktionen in dieser Datei als Server-Actions (laufen sicher im Backend)

import { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

/**
 * Verarbeitet die Formulareingaben der Gäste auf der Event-Seite.
 * Legt entweder eine neue Antwort an oder überschreibt eine bestehende (bei mitgeliefertem Edit-Token).
 */
export async function submitRsvp(formData: FormData) {
  // Grundlegende Identifikationsdaten auslesen
  const eventId = formData.get('eventId') as string
  const editToken = formData.get('editToken') as string || null 
  const name = formData.get('name') as string
  const isAttending = formData.get('isAttending') === 'true'
  
  // Optionale Felder auslesen
  const email = formData.get('email') as string || null
  const phone = formData.get('phone') as string || null
  const dietaryOption = formData.get('dietaryOption') as string || null
  const drinksAlcohol = formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null
  const additionalInfo = formData.get('additionalInfo') as string || null
  const declineReason = formData.get('declineReason') as string || null

  const plusOne = formData.get('plusOne') === 'true'
  const plusOneName = formData.get('plusOneName') as string || null
  const allergies = formData.get('allergies') as string || null
  const bringingItem = formData.get('bringingItem') as string || null

  // Bereinigung der Daten: Optionale Informationen werden nur bei einer Zusage (isAttending) gespeichert.
  // Bei einer Absage werden diese Felder auf null gesetzt, um die Datenbank sauber zu halten.
  const data = {
    eventId,
    name,
    isAttending,
    email: isAttending ? email : null,
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

  // Wenn ein editToken mitgeschickt wurde, handelt es sich um eine Bearbeitung
  if (editToken) {
    savedRsvp = await prisma.rsvp.update({
      where: { editToken },
      data
    })
  } else {
    // Wenn kein Token vorhanden ist, wird ein neuer Eintrag erzeugt
    // Der Token (UUID) wird direkt hier serverseitig generiert
    savedRsvp = await prisma.rsvp.create({
      data: {
        ...data,
        editToken: randomUUID()
      }
    })
  }

  // Next.js Cache leeren, damit die neuen Daten sofort auf den betroffenen Seiten sichtbar werden
  revalidatePath(`/${eventId}`)
  revalidatePath('/admin') 
  
  // Den generierten oder genutzten Token zurückgeben, um den personalisierten Link im Formular anzuzeigen
  return { editToken: savedRsvp.editToken }
}