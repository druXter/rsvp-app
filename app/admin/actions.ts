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
 * Prüft die Admin-Session. Wirft, wenn nicht eingeloggt.
 */
async function requireAdmin() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session || session.value !== 'true') throw new Error('Nicht autorisiert')
}

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
 * Legt ein neues, eigenständiges Event in der Datenbank an (Standard-Fall).
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

  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const requireVerification = formData.get('requireVerification') === 'on'
  const enableCheckin = formData.get('enableCheckin') === 'on'

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
      eventPin,
      enableCheckin
    }
  })

  // Cache leeren und zum Dashboard umleiten
  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Löscht ein Event mitsamt aller zugehörigen Antworten aus der Datenbank.
 * Gehört das Event zu einer Reihe, bleiben die Participants (ihr Profil gilt
 * ggf. noch für andere Termine der Reihe) unangetastet.
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

  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const requireVerification = formData.get('requireVerification') === 'on'
  const enableCheckin = formData.get('enableCheckin') === 'on'

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
      eventPin,
      enableCheckin
    }
  })

  // Nach dem Speichern prüfen, ob durch eine Erhöhung der maxCapacity Leute nachrücken dürfen
  await triggerWaitlistPromotion(id)

  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Löscht eine spezifische Antwort (RSVP) eines Gastes zu einem Termin.
 * Der Participant (das Profil) bleibt bestehen, falls er noch andere Antworten hat.
 */
export async function deleteRsvp(formData: FormData) {
  const id = formData.get('rsvpId') as string

  const rsvpToDelete = await prisma.rsvp.findUnique({ where: { id } })
  if (!rsvpToDelete) return

  await prisma.rsvp.delete({
    where: { id }
  })

  if (rsvpToDelete.isAttending && !rsvpToDelete.isOnWaitlist) {
    await triggerWaitlistPromotion(rsvpToDelete.eventId)
  }

  revalidatePath('/admin')
}

/**
 * Ermöglicht es dem Administrator, die Antwort eines Gastes zu einem Termin manuell
 * zu bearbeiten - inklusive der reihenweit geteilten Profildaten (Name, Kontakt, Essen).
 */
export async function updateAdminRsvp(formData: FormData) {
  const id = formData.get('rsvpId') as string
  const name = formData.get('name') as string
  const isAttending = formData.get('isAttending') === 'true'

  const email = formData.get('email') as string || null
  const phone = formData.get('phone') as string || null
  const dietaryOption = formData.get('dietaryOption') as string || null
  const allergies = formData.get('allergies') as string || null

  const drinksAlcohol = formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null
  const additionalInfo = formData.get('additionalInfo') as string || null
  const declineReason = formData.get('declineReason') as string || null

  const plusOne = formData.get('plusOne') === 'true'
  const plusOneName = formData.get('plusOneName') as string || null
  const bringingItem = formData.get('bringingItem') as string || null

  const existingRsvp = await prisma.rsvp.findUnique({ where: { id } })
  if (!existingRsvp) return

  await prisma.participant.update({
    where: { id: existingRsvp.participantId },
    data: { name, email, phone, dietaryOption, allergies }
  })

  await prisma.rsvp.update({
    where: { id },
    data: {
      isAttending,
      drinksAlcohol: isAttending ? drinksAlcohol : null,
      additionalInfo: isAttending ? additionalInfo : null,
      plusOne: isAttending ? plusOne : false,
      plusOneName: isAttending && plusOne ? plusOneName : null,
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
    include: { event: { include: { series: true } }, participant: true }
  })
  if (!rsvp || !rsvp.isOnWaitlist) return

  // Admin-Override: Wir ändern den Status direkt auf einen festen Platz
  const promotedRsvp = await prisma.rsvp.update({
    where: { id },
    data: { isOnWaitlist: false }
  })

  // Erfolgs-Mails senden
  if (rsvp.participant.email) {
    await sendWaitlistPromotedEmail(rsvp.participant, promotedRsvp, rsvp.event)
    await sendConfirmationEmail(rsvp.participant, promotedRsvp, rsvp.event)
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
    include: { rsvps: true, series: true }
  })
  if (!event || event.maxCapacity === null) return;

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

  // Aktuelle Anzahl der Leute mit festem Platz zählen
  let currentAttendeesCount = event.rsvps.filter(r => r.isAttending && !r.isOnWaitlist).length;

  // Solange Plätze frei sind...
  while (currentAttendeesCount < event.maxCapacity) {
    const nextInLine = await prisma.rsvp.findFirst({
      where: {
        eventId: event.id,
        isAttending: true,
        isOnWaitlist: true,
        ...(requireVerification ? { participant: { isVerified: true } } : {})
      },
      orderBy: { createdAt: 'asc' }, // Derjenige, der am längsten wartet
      include: { participant: true }
    })

    if (!nextInLine) break; // Niemand mehr auf der Warteliste

    const promotedRsvp = await prisma.rsvp.update({
      where: { id: nextInLine.id },
      data: { isOnWaitlist: false }
    })

    if (nextInLine.participant.email) {
      await sendWaitlistPromotedEmail(nextInLine.participant, promotedRsvp, event);
      await sendConfirmationEmail(nextInLine.participant, promotedRsvp, event);
    }

    currentAttendeesCount++; // Zähler für den nächsten Schleifendurchlauf erhöhen
  }
}

/**
 * Server Action: Versendet Erinnerungen an alle zugesagten Gäste eines Termins.
 * Schützt die Route via Cookie-Prüfung und aktualisiert danach das Dashboard.
 */
export async function sendReminder(formData: FormData) {
  await requireAdmin()

  const eventId = formData.get('eventId') as string
  const customMessage = formData.get('customMessage') as string

  if (!eventId) return

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rsvps: {
        where: { isAttending: true },
        include: { participant: true }
      }
    }
  })

  if (!event) throw new Error('Event nicht gefunden')

  const validRsvps = event.rsvps.filter(rsvp => rsvp.participant.email && rsvp.participant.email.trim() !== "")

  const emailPromises = validRsvps.map(rsvp =>
    sendReminderEmail(event, rsvp.participant, customMessage)
  )

  await Promise.allSettled(emailPromises)

  await prisma.event.update({
    where: { id: eventId },
    data: { reminderSent: true }
  })

  revalidatePath('/admin')
}

/**
 * Versendet die Verifizierungs-E-Mail (Double-Opt-In) manuell erneut.
 * Nützlich, wenn der Gast die E-Mail nicht erhalten oder versehentlich gelöscht hat.
 */
export async function resendVerificationEmail(formData: FormData) {
  await requireAdmin()

  const id = formData.get('rsvpId') as string

  const rsvp = await prisma.rsvp.findUnique({
    where: { id },
    include: { event: true, participant: true }
  })

  if (!rsvp || !rsvp.participant.email || rsvp.participant.isVerified) return

  let tokenToUse = rsvp.participant.verifyToken
  if (!tokenToUse) {
    tokenToUse = randomUUID()
    await prisma.participant.update({
      where: { id: rsvp.participant.id },
      data: { verifyToken: tokenToUse }
    })
  }

  await sendVerificationEmail(rsvp.participant, rsvp.event)
}

/**
 * Legt eine neue Veranstaltungsreihe an (optionales Feature neben Einzel-Events).
 */
export async function createEventSeries(formData: FormData) {
  await requireAdmin()

  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const description = formData.get('description') as string

  const askEmail = formData.get('askEmail') === 'on'
  const askPhone = formData.get('askPhone') === 'on'
  const askDiet = formData.get('askDiet') === 'on'
  const askAllergies = formData.get('askAllergies') === 'on'
  const requireVerification = formData.get('requireVerification') === 'on'
  const isGuestListVisible = formData.get('isGuestListVisible') === 'on'
  const eventPinInput = formData.get('eventPin') as string
  const eventPin = eventPinInput ? eventPinInput.trim() : null

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const series = await prisma.eventSeries.create({
    data: { title, slug, description, askEmail, askPhone, askDiet, askAllergies, requireVerification, isGuestListVisible, eventPin }
  })

  revalidatePath('/admin')
  redirect(`/admin/series/${series.id}`)
}

/**
 * Aktualisiert die reihenweiten Einstellungen (gilt für alle Termine der Reihe).
 */
export async function updateEventSeries(formData: FormData) {
  await requireAdmin()

  const id = formData.get('seriesId') as string
  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const description = formData.get('description') as string

  const askEmail = formData.get('askEmail') === 'on'
  const askPhone = formData.get('askPhone') === 'on'
  const askDiet = formData.get('askDiet') === 'on'
  const askAllergies = formData.get('askAllergies') === 'on'
  const requireVerification = formData.get('requireVerification') === 'on'
  const isGuestListVisible = formData.get('isGuestListVisible') === 'on'
  const eventPinInput = formData.get('eventPin') as string
  const eventPin = eventPinInput ? eventPinInput.trim() : null

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.eventSeries.update({
    where: { id },
    data: { title, slug, description, askEmail, askPhone, askDiet, askAllergies, requireVerification, isGuestListVisible, eventPin }
  })

  revalidatePath('/admin')
  redirect(`/admin/series/${id}`)
}

/**
 * Löscht eine komplette Veranstaltungsreihe inkl. aller Termine, Antworten und Profile.
 */
export async function deleteEventSeries(formData: FormData) {
  await requireAdmin()

  const id = formData.get('seriesId') as string

  const events = await prisma.event.findMany({ where: { seriesId: id }, select: { id: true } })
  const eventIds = events.map(e => e.id)

  await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } })
  await prisma.event.deleteMany({ where: { seriesId: id } })
  await prisma.participant.deleteMany({ where: { seriesId: id } })
  await prisma.eventSeries.delete({ where: { id } })

  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Fügt einer bestehenden Reihe einen neuen Termin hinzu. Die reihenweiten Felder
 * (E-Mail/Handy/Essen/Allergien-Abfrage, Verifizierung, Gästeliste, PIN) kommen von
 * der EventSeries - hier werden nur die pro Termin abweichenden Daten abgefragt.
 */
export async function addTerminToSeries(formData: FormData) {
  await requireAdmin()

  const seriesId = formData.get('seriesId') as string
  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const date = new Date(formData.get('date') as string)
  const location = formData.get('location') as string
  const description = formData.get('description') as string
  const duration = parseInt(formData.get('duration') as string) || 4
  const maxCapStr = formData.get('maxCapacity') as string
  const maxCapacity = maxCapStr ? parseInt(maxCapStr) : null

  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const enableCheckin = formData.get('enableCheckin') === 'on'

  const formConfig = JSON.stringify({
    askEmail: false,
    askPhone: false,
    askDiet: false,
    askAllergies: false,
    askAlcohol: formData.get('askAlcohol') === 'on',
    askPlusOne: formData.get('askPlusOne') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
  })

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.event.create({
    data: {
      seriesId,
      title,
      slug,
      date,
      location,
      description,
      duration,
      formConfig,
      autoReminder,
      reminderDays,
      maxCapacity,
      enableCheckin
    }
  })

  revalidatePath('/admin')
  redirect(`/admin/series/${seriesId}`)
}

/**
 * Aktualisiert einen bestehenden Termin innerhalb einer Reihe. Anders als bei
 * updateEvent gibt es hier keine reihenweiten Felder (Profil-Abfragen, PIN,
 * Gästeliste, Verifizierung) - die kommen ausschließlich von der EventSeries.
 */
export async function updateSeriesTermin(formData: FormData) {
  await requireAdmin()

  const id = formData.get('eventId') as string
  const title = formData.get('title') as string
  const slugInput = formData.get('slug') as string
  const date = new Date(formData.get('date') as string)
  const location = formData.get('location') as string
  const description = formData.get('description') as string
  const duration = parseInt(formData.get('duration') as string) || 4
  const maxCapStr = formData.get('maxCapacity') as string
  const maxCapacity = maxCapStr ? parseInt(maxCapStr) : null

  const autoReminder = formData.get('autoReminder') === 'on'
  const reminderDays = parseInt(formData.get('reminderDays') as string) || 7
  const enableCheckin = formData.get('enableCheckin') === 'on'

  const formConfig = JSON.stringify({
    askEmail: false,
    askPhone: false,
    askDiet: false,
    askAllergies: false,
    askAlcohol: formData.get('askAlcohol') === 'on',
    askPlusOne: formData.get('askPlusOne') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
  })

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const event = await prisma.event.update({
    where: { id },
    data: { title, slug, date, location, description, duration, formConfig, autoReminder, reminderDays, maxCapacity, enableCheckin }
  })

  await triggerWaitlistPromotion(id)

  revalidatePath('/admin')
  redirect(`/admin/series/${event.seriesId}`)
}

/**
 * Manuelles Ein-/Auschecken eines Gasts aus der Gästeliste im Admin-Dashboard
 * (Alternative zum Scannen des QR-Codes, z.B. falls der Gast kein Handy dabei hat).
 */
export async function toggleAttendance(formData: FormData) {
  await requireAdmin()

  const id = formData.get('rsvpId') as string
  const rsvp = await prisma.rsvp.findUnique({ where: { id } })
  if (!rsvp) return

  await prisma.rsvp.update({
    where: { id },
    data: {
      hasAttended: !rsvp.hasAttended,
      checkedInAt: !rsvp.hasAttended ? new Date() : null
    }
  })

  revalidatePath('/admin')
}
