// app/admin/actions.ts
'use server' // Deklariert diese Datei als reine Backend-Logik (Server Actions)

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { sendReminderEmail, sendWaitlistPromotedEmail, sendConfirmationEmail, sendVerificationEmail } from '../lib/mail'

const prisma = new PrismaClient()

/**
 * Sicherheits-Fallback für das Admin-Passwort.
 * Lädt das Passwort aus den Umgebungsvariablen (.env). Ist dort keines definiert,
 * wird zur Laufzeit ein zufälliges Passwort generiert, um unbefugten Zugriff zu verhindern.
 */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || Math.random().toString(36).slice(2)

/**
 * Überprüft die Zugangsdaten und erstellt bei Erfolg eine Admin-Sitzung via Cookie.
 */
export async function loginAdmin(formData: FormData) {
  const password = formData.get('password') as string

  if (password === ADMIN_PASSWORD) {
    const cookieStore = await cookies()
    cookieStore.set('admin_session', 'true', {
      httpOnly: true, // Schützt vor Cross-Site-Scripting (XSS)
      secure: process.env.NODE_ENV === 'production', // Überträgt Cookies in Produktion nur über HTTPS
      maxAge: 60 * 60 * 24, // Sitzung bleibt für 24 Stunden gültig
      path: '/',
    })
    redirect('/admin')
  } else {
    // Bei falschem Passwort mit Fehler-Parameter zurück zur Login-Seite
    redirect('/admin/login?error=1')
  }
}

/**
 * Beendet die Admin-Sitzung, indem das Authentifizierungs-Cookie gelöscht wird.
 */
export async function logoutAdmin() {
  const cookieStore = await cookies()
  cookieStore.set('admin_session', '', { maxAge: 0, path: '/' })
  redirect('/admin/login')
}

/**
 * Legt ein neues Event in der Datenbank an.
 * Konvertiert die Formulardaten in das passende Datenbank-Format und serialisiert
 * die dynamische Formular-Konfiguration als JSON.
 */
export async function createEvent(formData: FormData) {
  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const date = new Date(formData.get('date') as string)
  const location = formData.get('location') as string
  const description = formData.get('description') as string
  const duration = parseInt(formData.get('duration') as string) || 4 // Fallback auf 4 Stunden
  const maxCapStr = formData.get('maxCapacity') as string
  const maxCapacity = maxCapStr ? parseInt(maxCapStr) : null
  const isGuestListVisible = formData.get('isGuestListVisible') === 'on'
  const eventPinInput = formData.get('eventPin') as string
  const eventPin = eventPinInput ? eventPinInput.trim() : null

  // NEU: Cronjob-Einstellungen auslesen
  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const requireVerification = formData.get('requireVerification') === 'on'

  // Abfrage-Optionen für die Gäste als JSON-String speichern
  const formConfig = JSON.stringify({
    askEmail: formData.get('askEmail') === 'on',
    askPhone: formData.get('askPhone') === 'on',
    askDiet: formData.get('askDiet') === 'on',
    askAlcohol: formData.get('askAlcohol') === 'on',
    askPlusOne: formData.get('askPlusOne') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
    askAllergies: formData.get('askAllergies') === 'on',
  })

  // Den URL-Slug normalisieren (nur Kleinbuchstaben und Bindestriche)
  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.event.create({
    data: {
      title,
      slug,
      date,
      location,
      description,
      duration,
      formConfig,
      autoReminder,
      reminderDays,
      requireVerification,
      maxCapacity,
      isGuestListVisible,
      eventPin
    }
  })

  // Cache leeren und zum Dashboard umleiten
  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Löscht ein Event mitsamt aller zugehörigen Antworten aus der Datenbank.
 */
export async function deleteEvent(formData: FormData) {
  const id = formData.get('eventId') as string
  
  // 1. Zuerst alle verknüpften Antworten (Gäste) löschen, um Fremdschlüssel-Konflikte zu vermeiden
  await prisma.rsvp.deleteMany({
    where: { eventId: id }
  })
  
  // 2. Anschließend das eigentliche Event löschen
  await prisma.event.delete({
    where: { id }
  })
  
  revalidatePath('/admin')
}

/**
 * Aktualisiert die Meta-Daten und die Formular-Konfiguration eines bestehenden Events.
 */
export async function updateEvent(formData: FormData) {
  const id = formData.get('eventId') as string
  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const date = new Date(formData.get('date') as string)
  const location = formData.get('location') as string
  const description = formData.get('description') as string
  const duration = parseInt(formData.get('duration') as string) || 4 
  const maxCapStr = formData.get('maxCapacity') as string
  const maxCapacity = maxCapStr ? parseInt(maxCapStr) : null
  const isGuestListVisible = formData.get('isGuestListVisible') === 'on'
  const eventPinInput = formData.get('eventPin') as string
  const eventPin = eventPinInput ? eventPinInput.trim() : null

  // Cronjob-Einstellungen auslesen
  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const requireVerification = formData.get('requireVerification') === 'on'

  // Aktualisierte Formular-Optionen serialisieren
  const formConfig = JSON.stringify({
    askEmail: formData.get('askEmail') === 'on',
    askPhone: formData.get('askPhone') === 'on',
    askDiet: formData.get('askDiet') === 'on',
    askAlcohol: formData.get('askAlcohol') === 'on',
    askPlusOne: formData.get('askPlusOne') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
    askAllergies: formData.get('askAllergies') === 'on',
  })

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.event.update({
    where: { id },
    data: {
      title,
      slug,
      date,
      location,
      description,
      duration,
      formConfig,
      autoReminder,
      reminderDays,
      requireVerification,
      maxCapacity,
      isGuestListVisible,
      eventPin
    }
  })

  // Nach dem Speichern prüfen, ob durch eine Erhöhung der maxCapacity Leute nachrücken dürfen
  await triggerWaitlistPromotion(id)

  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Löscht eine spezifische Antwort (RSVP) eines Gastes.
 */
export async function deleteRsvp(formData: FormData) {
  const id = formData.get('rsvpId') as string
  
  // 1. Gast vor dem Löschen laden, um zu sehen, ob ein fester Platz frei wird
  const rsvpToDelete = await prisma.rsvp.findUnique({ where: { id } })
  if (!rsvpToDelete) return

  // 2. Gast löschen
  await prisma.rsvp.delete({
    where: { id }
  })
  
  // 3. Nachrück-Automatik auslösen, falls der Gast einen FESTEN Platz hatte
  if (rsvpToDelete.isAttending && !rsvpToDelete.isOnWaitlist) {
    await triggerWaitlistPromotion(rsvpToDelete.eventId)
  }
  
  revalidatePath('/admin')
}

/**
 * Ermöglicht es dem Administrator, die Antwort eines Gastes manuell zu bearbeiten
 */
export async function updateAdminRsvp(formData: FormData) {
  const id = formData.get('rsvpId') as string
  const name = formData.get('name') as string
  const isAttending = formData.get('isAttending') === 'true'
  
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

  // Alten Status VOR dem Update laden
  const existingRsvp = await prisma.rsvp.findUnique({ where: { id } })
  if (!existingRsvp) return

  await prisma.rsvp.update({
    where: { id },
    data: {
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
  })

  // Wenn du als Admin jemanden nachträglich von "Kommt" auf "Kommt nicht" setzt:
  if (existingRsvp.isAttending && !existingRsvp.isOnWaitlist && !isAttending) {
    await triggerWaitlistPromotion(existingRsvp.eventId)
  }

  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Lässt einen Gast manuell von der Warteliste zu, selbst wenn das Event überbucht wird.
 */
export async function promoteFromWaitlist(formData: FormData) {
  const id = formData.get('rsvpId') as string
  
  const rsvp = await prisma.rsvp.findUnique({ 
    where: { id }, 
    include: { event: true } 
  })
  if (!rsvp || !rsvp.isOnWaitlist) return

  // Admin-Override: Wir ändern den Status direkt auf einen festen Platz
  const promotedRsvp = await prisma.rsvp.update({
    where: { id },
    data: { isOnWaitlist: false }
  })

  // Erfolgs-Mails senden
  if (promotedRsvp.email) {
    await sendWaitlistPromotedEmail(promotedRsvp, rsvp.event);
    await sendConfirmationEmail(promotedRsvp, rsvp.event);
  }

  revalidatePath('/admin')
}

/**
 * HILFSFUNKTION: Füllt freie Plätze mit Nachrückern von der Warteliste auf.
 * Funktioniert für einzelne freiwerdende Plätze UND wenn der Admin die Kapazität erhöht.
 */
async function triggerWaitlistPromotion(eventId: string) {
  const event = await prisma.event.findUnique({ 
    where: { id: eventId },
    include: { rsvps: true }
  })
  if (!event || event.maxCapacity === null) return;

  // Aktuelle Anzahl der Leute mit festem Platz zählen
  let currentAttendeesCount = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).length;

  // Solange Plätze frei sind...
  while (currentAttendeesCount < event.maxCapacity) {
    const nextInLine = await prisma.rsvp.findFirst({
      where: { 
        eventId: event.id, 
        isAttending: true, 
        isOnWaitlist: true,
        ...(event.requireVerification ? { isVerified: true } : {})
      },
      orderBy: { createdAt: 'asc' } // Derjenige, der am längsten wartet
    });

    if (!nextInLine) break; // Niemand mehr auf der Warteliste

    const promotedRsvp = await prisma.rsvp.update({
      where: { id: nextInLine.id },
      data: { isOnWaitlist: false } 
    });

    if (promotedRsvp.email) {
      await sendWaitlistPromotedEmail(promotedRsvp, event);
      await sendConfirmationEmail(promotedRsvp, event); 
    }

    currentAttendeesCount++; // Zähler für den nächsten Schleifendurchlauf erhöhen
  }
}

/**
 * Server Action: Versendet Erinnerungen an alle zugesagten Gäste eines Events.
 * Schützt die Route via Cookie-Prüfung und aktualisiert danach das Dashboard.
 */
export async function sendReminder(formData: FormData) {
  // 1. Security First: Prüfen, ob der User wirklich Admin ist
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  
  if (!session || session.value !== 'true') {
    throw new Error('Nicht autorisiert')
  }

  // 2. Daten aus dem Formular auslesen
  const eventId = formData.get('eventId') as string
  const customMessage = formData.get('customMessage') as string

  if (!eventId) return

  // 3. Das Event und alle relevanten RSVPs (Nur Zusagen + hat E-Mail) aus der DB holen
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rsvps: {
        where: {
          isAttending: true, // Nur Leute, die zugesagt haben
          email: { not: null} // Nur Leute, die eine E-Mail hinterlegt haben
        }
      }
    }
  })

  if (!event) throw new Error('Event nicht gefunden')

  const validRsvps = event.rsvps.filter(rsvp => rsvp.email && rsvp.email.trim() !== "")

  // 4. Mails asynchron über unsere neue Funktion verschicken
  const emailPromises = validRsvps.map(rsvp => 
    sendReminderEmail(event, rsvp, customMessage)
  )

  await Promise.allSettled(emailPromises)

  // 5. In der Datenbank vermerken, dass eine Erinnerung gesendet wurde
  await prisma.event.update({
    where: { id: eventId },
    data: { reminderSent: true }
  })

  // 6. Das UI (Admin-Dashboard) neu laden, um das "Erinnerung wurde gesendet"-Label anzuzeigen
  revalidatePath('/admin')
}

/**
 * Versendet die Verifizierungs-E-Mail (Double-Opt-In) manuell erneut.
 * Nützlich, wenn der Gast die E-Mail nicht erhalten oder versehentlich gelöscht hat.
 */
export async function resendVerificationEmail(formData: FormData) {
  // Sicherheits-Check
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session || session.value !== 'true') throw new Error('Nicht autorisiert')

  const id = formData.get('rsvpId') as string
  
  const rsvp = await prisma.rsvp.findUnique({
    where: { id },
    include: { event: true }
  })

  // Wenn der Gast nicht existiert, keine Mail hat oder ohnehin schon verifiziert ist, abbrechen
  if (!rsvp || !rsvp.email || rsvp.isVerified) return

  // Fallback: Falls durch einen Bug (oder alte Daten) kein verifyToken existiert, 
  // generieren wir sicherheitshalber einen neuen.
  let tokenToUse = rsvp.verifyToken
  if (!tokenToUse) {
    tokenToUse = randomUUID()
    await prisma.rsvp.update({
      where: { id },
      data: { verifyToken: tokenToUse }
    })
    rsvp.verifyToken = tokenToUse
  }

  // Die Mail-Funktion aufrufen
  await sendVerificationEmail(rsvp, rsvp.event)
}