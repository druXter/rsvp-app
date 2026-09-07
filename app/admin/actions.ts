// app/admin/actions.ts
'use server' // Deklariert diese Datei als reine Backend-Logik (Server Actions)

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { PrismaClient } from '@prisma/client'
import { randomUUID, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { sendReminderEmail, sendWaitlistPromotedEmail, sendConfirmationEmail, sendVerificationEmail } from '../lib/mail'
import { requireUser, SESSION_COOKIE, SESSION_DURATION_MS } from '../lib/auth'

const prisma = new PrismaClient()

/**
 * Liest die bis zu 3 frei definierbaren Zusatzfragen aus dem Formular
 * (leere Felder werden verworfen).
 */
function readCustomQuestions(formData: FormData): string[] {
  return [
    formData.get('customQuestion1') as string,
    formData.get('customQuestion2') as string,
    formData.get('customQuestion3') as string,
  ]
    .map(q => (q || '').trim())
    .filter(q => q !== '')
}

/**
 * Prüft E-Mail/Passwort gegen die Datenbank und erstellt bei Erfolg eine
 * server-seitige Session (Cookie enthält nur den opaken Token, siehe app/lib/auth.ts).
 */
export async function loginUser(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formData.get('password') as string

  const user = await prisma.user.findUnique({ where: { email } })
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false

  if (!user || !passwordMatches) {
    redirect('/admin/login?error=1')
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  await prisma.session.create({ data: { token, userId: user.id, expiresAt } })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true, // Schützt vor Cross-Site-Scripting (XSS)
    secure: process.env.NODE_ENV === 'production', // Überträgt Cookies in Produktion nur über HTTPS
    maxAge: SESSION_DURATION_MS / 1000,
    path: '/',
  })
  redirect('/admin')
}

/**
 * Beendet die Sitzung: löscht die Session in der Datenbank und das Cookie.
 */
export async function logoutUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.delete({ where: { token } }).catch(() => {})
  }
  cookieStore.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' })
  redirect('/admin/login')
}

/**
 * Legt ein neues Benutzerkonto an (z.B. für ein anderes Referat oder einen Freund).
 * Es gibt keine öffentliche Registrierung - nur bereits eingeloggte Nutzer können
 * weitere Konten anlegen.
 */
export async function createUser(formData: FormData) {
  await requireUser()

  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formData.get('password') as string

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    redirect('/admin/create-user?error=exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await prisma.user.create({ data: { email, passwordHash } })

  revalidatePath('/admin')
  redirect('/admin')
}

/**
 * Legt ein neues, eigenständiges Event in der Datenbank an (Standard-Fall).
 * Konvertiert die Formulardaten in das passende Datenbank-Format und serialisiert
 * die dynamische Formular-Konfiguration als JSON.
 */
export async function createEvent(formData: FormData) {
  const user = await requireUser()

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
    customQuestions: readCustomQuestions(formData),
  })

  // Den URL-Slug normalisieren (nur Kleinbuchstaben und Bindestriche)
  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.event.create({
    data: {
      ownerId: user.id,
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
  const user = await requireUser()
  const id = formData.get('eventId') as string

  const event = await prisma.event.findUnique({ where: { id } })
  if (!event || event.ownerId !== user.id) return

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
  const user = await requireUser()
  const id = formData.get('eventId') as string

  const existingEvent = await prisma.event.findUnique({ where: { id } })
  if (!existingEvent || existingEvent.ownerId !== user.id) return

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
    customQuestions: readCustomQuestions(formData),
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
  const user = await requireUser()
  const id = formData.get('rsvpId') as string

  const rsvpToDelete = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvpToDelete || rsvpToDelete.event.ownerId !== user.id) return

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
  const user = await requireUser()
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

  const existingRsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!existingRsvp || existingRsvp.event.ownerId !== user.id) return

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
  const user = await requireUser()
  const id = formData.get('rsvpId') as string

  const rsvp = await prisma.rsvp.findUnique({
    where: { id },
    include: { event: { include: { series: true } }, participant: true }
  })
  if (!rsvp || !rsvp.isOnWaitlist || rsvp.event.ownerId !== user.id) return

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
 * Wird ausschließlich von bereits Owner-geprüften Actions aufgerufen.
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
 * Schützt die Route via Session-Prüfung und aktualisiert danach das Dashboard.
 */
export async function sendReminder(formData: FormData) {
  const user = await requireUser()

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

  if (!event || event.ownerId !== user.id) return

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
  const user = await requireUser()

  const id = formData.get('rsvpId') as string

  const rsvp = await prisma.rsvp.findUnique({
    where: { id },
    include: { event: true, participant: true }
  })

  if (!rsvp || rsvp.event.ownerId !== user.id || !rsvp.participant.email || rsvp.participant.isVerified) return

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
  const user = await requireUser()

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
    data: { ownerId: user.id, title, slug, description, askEmail, askPhone, askDiet, askAllergies, requireVerification, isGuestListVisible, eventPin }
  })

  revalidatePath('/admin')
  redirect(`/admin/series/${series.id}`)
}

/**
 * Aktualisiert die reihenweiten Einstellungen (gilt für alle Termine der Reihe).
 */
export async function updateEventSeries(formData: FormData) {
  const user = await requireUser()

  const id = formData.get('seriesId') as string
  const existingSeries = await prisma.eventSeries.findUnique({ where: { id } })
  if (!existingSeries || existingSeries.ownerId !== user.id) return

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
  const user = await requireUser()

  const id = formData.get('seriesId') as string
  const existingSeries = await prisma.eventSeries.findUnique({ where: { id } })
  if (!existingSeries || existingSeries.ownerId !== user.id) return

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
  const user = await requireUser()

  const seriesId = formData.get('seriesId') as string
  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
  if (!series || series.ownerId !== user.id) return

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
    customQuestions: readCustomQuestions(formData),
  })

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.event.create({
    data: {
      ownerId: series.ownerId,
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
  const user = await requireUser()

  const id = formData.get('eventId') as string
  const existingEvent = await prisma.event.findUnique({ where: { id } })
  if (!existingEvent || existingEvent.ownerId !== user.id) return

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
    customQuestions: readCustomQuestions(formData),
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
  const user = await requireUser()

  const id = formData.get('rsvpId') as string
  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvp || rsvp.event.ownerId !== user.id) return

  await prisma.rsvp.update({
    where: { id },
    data: {
      hasAttended: !rsvp.hasAttended,
      checkedInAt: !rsvp.hasAttended ? new Date() : null
    }
  })

  revalidatePath('/admin')
}

/**
 * Speichert das Push-Abo eines Geräts (Browser-Endpoint + Verschlüsselungs-Keys) für
 * den eingeloggten Nutzer. Wird ein bereits bekannter Endpoint erneut abonniert (z.B.
 * nach Ablauf erneuert), werden einfach die Keys aktualisiert statt einen Duplikat-Eintrag anzulegen.
 */
export async function subscribeToPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const user = await requireUser()

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userId: user.id },
    create: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userId: user.id }
  })
}

/**
 * Entfernt das Push-Abo eines Geräts wieder (Nutzer hat Benachrichtigungen deaktiviert).
 */
export async function unsubscribeFromPush(endpoint: string) {
  const user = await requireUser()

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } })
}
