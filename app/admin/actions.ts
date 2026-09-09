// app/admin/actions.ts
'use server' // Deklariert diese Datei als reine Backend-Logik (Server Actions)

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { PrismaClient, Role } from '@prisma/client'
import { randomUUID, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { sendReminderEmail, sendWaitlistPromotedEmail, sendConfirmationEmail, sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeConfirmation, sendEventUpdatedEmail } from '../lib/mail'
import { requireUser, SESSION_COOKIE, SESSION_DURATION_MS } from '../lib/auth'
import { isOwnerOrAdmin, hasEventModeratorOrAbove, hasSeriesModeratorOrAbove } from '../lib/permissions'
import { sendReminderPush, sendEventChangedPush } from '../lib/push'

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
 * Liest die optionalen Felder für einen externen Abstimmungs-Link (Event.pollUrl/
 * pollLabel, siehe schema.prisma und app/api/poll-link/[eventId]/route.ts) - leere
 * Felder werden zu null statt leerem String, gleiche Konvention wie eventPin.
 */
function readPollLink(formData: FormData): { pollUrl: string | null; pollLabel: string | null } {
  const pollUrlInput = (formData.get('pollUrl') as string || '').trim()
  const pollLabelInput = (formData.get('pollLabel') as string || '').trim()
  return {
    pollUrl: pollUrlInput || null,
    pollLabel: pollLabelInput || null
  }
}

/**
 * Vergleicht die für Gäste relevanten Termin-Felder (Titel/Datum/Dauer/Ort/Beschreibung)
 * vor und nach einer Bearbeitung. Gemeinsam genutzt von updateEvent und
 * updateSeriesTermin, damit "was zählt als dringende Änderung" an genau einer Stelle
 * definiert ist. Ein nicht-leeres Ergebnis entscheidet sowohl, ob die ICS-SEQUENCE
 * hochgezählt wird, als auch (bei angehaktem "Teilnehmende benachrichtigen"), ob
 * überhaupt eine Änderungs-Mail verschickt wird.
 */
function diffEventFields(
  existing: { title: string; date: Date; duration: number; location: string | null; description: string | null },
  updated: { title: string; date: Date; duration: number; location: string | null; description: string | null }
): { label: string; detail: string }[] {
  const changes: { label: string; detail: string }[] = []
  const fmt = (d: Date) => d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  if (existing.title !== updated.title) {
    changes.push({ label: 'Titel', detail: `„${existing.title}“ → „${updated.title}“` })
  }
  if (existing.date.getTime() !== updated.date.getTime()) {
    changes.push({ label: 'Datum & Uhrzeit', detail: `${fmt(existing.date)} Uhr → ${fmt(updated.date)} Uhr` })
  }
  if (existing.duration !== updated.duration) {
    changes.push({ label: 'Dauer', detail: `${existing.duration} Std. → ${updated.duration} Std.` })
  }
  if ((existing.location || '') !== (updated.location || '')) {
    changes.push({ label: 'Ort', detail: `${existing.location || '(keine Angabe)'} → ${updated.location || '(keine Angabe)'}` })
  }
  if ((existing.description || '') !== (updated.description || '')) {
    changes.push({ label: 'Beschreibung', detail: 'wurde aktualisiert' })
  }
  return changes
}

/**
 * Verschickt die Änderungs-Mail (siehe sendEventUpdatedEmail) an alle Gäste mit fester
 * Zusage oder Wartelisten-Platz zu genau diesem Termin - unabhängig von Reihen-
 * Zugehörigkeit gilt Kapazität/Teilnahme wie überall sonst pro Termin. Berücksichtigt bei
 * einer Reihe die reihenweite requireVerification (siehe CLAUDE.md "Effective settings").
 */
async function notifyAttendeesOfChange(eventId: string, changes: { label: string; detail: string }[]) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rsvps: { where: { isAttending: true }, include: { participant: true } },
      series: true
    }
  })
  if (!event) return

  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification

  const validRsvps = event.rsvps.filter(rsvp =>
    rsvp.participant.email && rsvp.participant.email.trim() !== '' &&
    (!requireVerification || rsvp.participant.isVerified)
  )

  const emailPromises = validRsvps.map(rsvp =>
    sendEventUpdatedEmail(rsvp.participant, rsvp, event, changes)
  )
  // Push ist an die Participant-Identität geknüpft, nicht an eine verifizierte E-Mail -
  // gilt daher für alle Teilnehmenden, die effektiv verifiziert sind (bzw. für die es gar
  // nicht nötig ist), unabhängig davon, ob überhaupt eine E-Mail hinterlegt wurde.
  const pushEligibleRsvps = event.rsvps.filter(rsvp => !requireVerification || rsvp.participant.isVerified)
  const pushPromises = pushEligibleRsvps.map(rsvp =>
    sendEventChangedPush(event, rsvp.participant, changes)
  )
  await Promise.allSettled([...emailPromises, ...pushPromises])
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

const RESET_TOKEN_DURATION_MS = 1000 * 60 * 60 // 1 Stunde

/**
 * Fordert einen Passwort-Reset per E-Mail an. Zeigt IMMER dieselbe neutrale Bestätigung
 * (Weiterleitung zu ?sent=1) - unabhängig davon, ob die E-Mail überhaupt zu einem Konto
 * gehört oder ob es sich um ein Admin-Konto handelt, damit weder die Existenz eines
 * Kontos noch dessen Admin-Status über das Antwortverhalten verraten wird. Für
 * Admin-Konten wird bewusst NIE ein Reset-Token vergeben (siehe #13/#5) - dort bleibt
 * ein Reset ausschließlich über direkten Server-Zugriff (create-user.js/set-role.js)
 * möglich, damit ein kompromittiertes Admin-Postfach nicht automatisch vollen Zugriff gibt.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const user = await prisma.user.findUnique({ where: { email } })

  if (user && user.role !== 'ADMIN') {
    const resetToken = randomBytes(32).toString('hex')
    const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_DURATION_MS)
    const updated = await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpiresAt } })
    try {
      await sendPasswordResetEmail(updated)
    } catch (error) {
      console.error('Fehler beim Senden der Passwort-Reset-Mail:', error)
    }
  }

  redirect('/admin/forgot-password?sent=1')
}

/**
 * Setzt anhand eines gültigen, nicht abgelaufenen Reset-Tokens ein neues Passwort.
 * Invalidiert dabei alle bestehenden Sessions des Kontos (z.B. falls das alte Passwort
 * durch einen Dritten kompromittiert wurde) und macht den Token unbrauchbar.
 */
export async function resetPassword(formData: FormData) {
  const token = formData.get('token') as string
  const password = formData.get('password') as string

  const user = token ? await prisma.user.findUnique({ where: { resetToken: token } }) : null
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    redirect('/admin/reset-password?error=invalid')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpiresAt: null }
  })
  await prisma.session.deleteMany({ where: { userId: user.id } })

  redirect('/admin/login?reset=1')
}

/**
 * Ändert das Passwort eines bereits eingeloggten Kontos (jeder Rolle, inkl. Admin) -
 * erfordert das aktuelle Passwort statt eines Mail-Links. Anders als der Reset per
 * Mail-Link (siehe requestPasswordReset, für Admin-Konten ausgeschlossen) reicht dafür
 * ein kompromittiertes Postfach nicht aus - es braucht zusätzlich eine aktive Session,
 * daher ist das auch für Admin-Konten sicher. Invalidiert alle ANDEREN Sessions dieses
 * Kontos, damit ein evtl. gestohlenes altes Passwort keinen dauerhaften Zugriff behält,
 * meldet die aktuelle Sitzung aber nicht ab.
 */
export async function changePassword(formData: FormData) {
  const user = await requireUser()

  const currentPassword = formData.get('currentPassword') as string
  const newPassword = formData.get('newPassword') as string

  const matches = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!matches) {
    redirect('/admin/account?error=wrongpassword')
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

  const cookieStore = await cookies()
  const currentToken = cookieStore.get(SESSION_COOKIE)?.value
  await prisma.session.deleteMany({ where: { userId: user.id, token: { not: currentToken } } })

  redirect('/admin/account?passwordChanged=1')
}

/**
 * Fordert eine E-Mail-Änderung an - erfordert das aktuelle Passwort. Die neue Adresse
 * wird erst nach Klick auf den an SIE (nicht an die alte Adresse) verschickten
 * Bestätigungslink wirksam (siehe /admin/confirm-email). Für jede Rolle inkl. Admin
 * verfügbar, siehe changePassword für die Begründung.
 */
export async function requestEmailChange(formData: FormData) {
  const user = await requireUser()

  const currentPassword = formData.get('currentPassword') as string
  const newEmail = (formData.get('newEmail') as string || '').trim().toLowerCase()

  const matches = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!matches) {
    redirect('/admin/account?error=wrongpassword')
  }

  if (newEmail === user.email) return

  const existing = await prisma.user.findUnique({ where: { email: newEmail } })
  if (existing) {
    redirect('/admin/account?error=emailtaken')
  }

  const emailChangeToken = randomBytes(32).toString('hex')
  const emailChangeTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_DURATION_MS)
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { pendingEmail: newEmail, emailChangeToken, emailChangeTokenExpiresAt }
  })

  try {
    await sendEmailChangeConfirmation(updated)
  } catch (error) {
    console.error('Fehler beim Senden der E-Mail-Änderungs-Bestätigung:', error)
  }

  redirect('/admin/account?emailChangeRequested=1')
}

/**
 * Bricht eine noch nicht bestätigte E-Mail-Änderung wieder ab.
 */
export async function cancelEmailChange() {
  const user = await requireUser()
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null }
  })
  redirect('/admin/account')
}

/**
 * Legt ein neues Benutzerkonto an (z.B. für ein anderes Referat, einen Freund oder
 * einen Moderator). Es gibt keine öffentliche Registrierung - nur bereits eingeloggte
 * Nutzer (außer Moderatoren) können weitere Konten anlegen. Nur Admins dürfen dabei
 * die Rolle CREATOR oder ADMIN vergeben - alle anderen Anfragen werden auf MODERATOR
 * heruntergestuft, damit nicht jeder Creator beliebig neue eigenständige Mandanten
 * (Creator-Konten) erzeugen kann.
 */
export async function createUser(formData: FormData) {
  const user = await requireUser()
  if (user.role === 'MODERATOR') return

  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formData.get('password') as string
  const requestedRole = formData.get('role') as Role
  const role: Role = (user.role === 'ADMIN' && (requestedRole === 'CREATOR' || requestedRole === 'ADMIN'))
    ? requestedRole
    : 'MODERATOR'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    redirect('/admin/create-user?error=exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await prisma.user.create({ data: { email, passwordHash, role } })

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
  if (user.role === 'MODERATOR') return

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
  const { pollUrl, pollLabel } = readPollLink(formData)

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
      enableCheckin,
      pollUrl,
      pollLabel
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
  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return

  // 1. Zuerst alle verknüpften Antworten (Gäste) und geteilten Zugriffsrechte löschen,
  // um Fremdschlüssel-Konflikte zu vermeiden
  await prisma.rsvp.deleteMany({
    where: { eventId: id }
  })
  await prisma.resourceAccess.deleteMany({
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
  if (!existingEvent || !isOwnerOrAdmin(user, existingEvent.ownerId)) return

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
  const notifyGuests = formData.get('notifyGuests') === 'on'
  const { pollUrl, pollLabel } = readPollLink(formData)

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

  // Dringende Änderungen erkennen, BEVOR die neuen Werte gespeichert werden - entscheidet
  // sowohl über das Hochzählen der ICS-SEQUENCE als auch (bei angehaktem "Teilnehmende
  // benachrichtigen") über den Versand der Änderungs-Mail (siehe diffEventFields oben).
  const changes = diffEventFields(existingEvent, { title, date, duration, location, description })

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
      enableCheckin,
      pollUrl,
      pollLabel,
      ...(changes.length > 0 ? { icsSequence: { increment: 1 } } : {})
    }
  })

  // Nach dem Speichern prüfen, ob durch eine Erhöhung der maxCapacity Leute nachrücken dürfen
  await triggerWaitlistPromotion(id)

  if (notifyGuests && changes.length > 0) {
    await notifyAttendeesOfChange(id, changes)
  }

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
  if (!rsvpToDelete || !(await hasEventModeratorOrAbove(user, rsvpToDelete.event))) return

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
  if (!existingRsvp || !(await hasEventModeratorOrAbove(user, existingRsvp.event))) return

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
  if (!rsvp || !rsvp.isOnWaitlist || !(await hasEventModeratorOrAbove(user, rsvp.event))) return

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
      },
      series: true
    }
  })

  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return

  const validRsvps = event.rsvps.filter(rsvp => rsvp.participant.email && rsvp.participant.email.trim() !== "")

  const emailPromises = validRsvps.map(rsvp =>
    sendReminderEmail(event, rsvp.participant, customMessage)
  )
  const pushPromises = event.rsvps.map(rsvp => sendReminderPush(event, rsvp.participant))

  await Promise.allSettled([...emailPromises, ...pushPromises])

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

  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event)) || !rsvp.participant.email || rsvp.participant.isVerified) return

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
  if (user.role === 'MODERATOR') return

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
  if (!existingSeries || !isOwnerOrAdmin(user, existingSeries.ownerId)) return

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
  if (!existingSeries || !isOwnerOrAdmin(user, existingSeries.ownerId)) return

  const events = await prisma.event.findMany({ where: { seriesId: id }, select: { id: true } })
  const eventIds = events.map(e => e.id)

  await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } })
  await prisma.resourceAccess.deleteMany({ where: { OR: [{ seriesId: id }, { eventId: { in: eventIds } }] } })
  await prisma.event.deleteMany({ where: { seriesId: id } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { seriesId: id } } })
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
  if (!series || !isOwnerOrAdmin(user, series.ownerId)) return

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
  if (!existingEvent || !isOwnerOrAdmin(user, existingEvent.ownerId)) return

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
  const notifyGuests = formData.get('notifyGuests') === 'on'
  const { pollUrl, pollLabel } = readPollLink(formData)

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

  // Siehe updateEvent: gleiche Diff-Logik, entscheidet über ICS-SEQUENCE und Mail-Versand.
  const changes = diffEventFields(existingEvent, { title, date, duration, location, description })

  const event = await prisma.event.update({
    where: { id },
    data: {
      title, slug, date, location, description, duration, formConfig, autoReminder, reminderDays, maxCapacity, enableCheckin,
      pollUrl, pollLabel,
      ...(changes.length > 0 ? { icsSequence: { increment: 1 } } : {})
    }
  })

  await triggerWaitlistPromotion(id)

  if (notifyGuests && changes.length > 0) {
    await notifyAttendeesOfChange(id, changes)
  }

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
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return

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

/**
 * Gewährt einem bestehenden Nutzer (per E-Mail) Moderator-Zugriff auf ein eigenes
 * Event ODER eine eigene Reihe. Nur der Owner selbst oder ein Admin darf teilen - ein
 * Creator, der selbst nur geteilten Zugriff auf eine Ressource hat, kann diesen nicht
 * weitergeben (er ist dort ja selbst nur Moderator, siehe hasEventModeratorOrAbove).
 */
export async function shareResource(formData: FormData) {
  const user = await requireUser()
  const eventId = formData.get('eventId') as string || null
  const seriesId = formData.get('seriesId') as string || null
  const email = (formData.get('email') as string || '').trim().toLowerCase()

  if (eventId) {
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || !isOwnerOrAdmin(user, event.ownerId)) return
  } else if (seriesId) {
    const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
    if (!series || !isOwnerOrAdmin(user, series.ownerId)) return
  } else {
    return
  }

  const target = await prisma.user.findUnique({ where: { email } })
  if (!target) {
    redirect(eventId ? `/admin/edit/${eventId}?shareError=notfound` : `/admin/series/${seriesId}/edit?shareError=notfound`)
  }

  await prisma.resourceAccess.upsert({
    where: eventId
      ? { userId_eventId: { userId: target.id, eventId } }
      : { userId_seriesId: { userId: target.id, seriesId: seriesId! } },
    update: {},
    create: { userId: target.id, eventId, seriesId }
  })

  revalidatePath('/admin')
  if (eventId) redirect(`/admin/edit/${eventId}`)
  redirect(`/admin/series/${seriesId}/edit`)
}

/**
 * Entzieht einen zuvor geteilten Moderator-Zugriff wieder. Nur der Owner der
 * betroffenen Ressource oder ein Admin darf das.
 */
export async function unshareResource(formData: FormData) {
  const user = await requireUser()
  const accessId = formData.get('accessId') as string

  const access = await prisma.resourceAccess.findUnique({
    where: { id: accessId },
    include: { event: true, series: true }
  })
  if (!access) return

  const ownerId = access.event?.ownerId ?? access.series?.ownerId
  if (!ownerId || !isOwnerOrAdmin(user, ownerId)) return

  await prisma.resourceAccess.delete({ where: { id: accessId } })
  revalidatePath('/admin')
}

/**
 * Ändert die Rolle eines bestehenden Kontos. Nur Admins dürfen das - und niemals für
 * ein Admin-Konto (auch nicht das eigene), damit kein Admin versehentlich sich selbst
 * oder einen anderen Admin degradiert und so der letzte funktionierende Admin-Zugang
 * verloren geht. Ein Rollenwechsel für ein Admin-Konto bleibt nur per set-role.js mit
 * direktem Server-Zugriff möglich.
 */
export async function updateUserRole(formData: FormData) {
  const user = await requireUser()
  if (user.role !== 'ADMIN') return

  const targetId = formData.get('userId') as string
  const role = formData.get('role') as Role
  if (!(['ADMIN', 'CREATOR', 'MODERATOR'] as Role[]).includes(role)) return

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target || target.role === 'ADMIN') return

  await prisma.user.update({ where: { id: targetId }, data: { role } })
  revalidatePath('/admin/users')
}

/**
 * Fügt ein BESTEHENDES Nutzer-Konto (per E-Mail, siehe #12/GuestUser) einer weiteren
 * Reihe hinzu - ohne dass dafür ein neues Konto nötig wäre (n:m-Mitgliedschaft). Owner,
 * ein per ResourceAccess geteilter Moderator oder ein Admin dürfen das; erstellt aber
 * NIE ein neues Nutzer-Konto (das geht nur über Selbstregistrierung).
 */
export async function addGuestUserToSeries(formData: FormData) {
  const user = await requireUser()
  const seriesId = formData.get('seriesId') as string
  const email = (formData.get('email') as string || '').trim().toLowerCase()

  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } })
  if (!series || !(await hasSeriesModeratorOrAbove(user, series))) return

  const guestUser = await prisma.guestUser.findUnique({ where: { email } })
  if (!guestUser) {
    redirect(`/admin/series/${seriesId}/edit?guestError=notfound`)
  }

  await prisma.guestUserSeries.upsert({
    where: { guestUserId_seriesId: { guestUserId: guestUser.id, seriesId } },
    update: {},
    create: { guestUserId: guestUser.id, seriesId }
  })

  revalidatePath(`/admin/series/${seriesId}/edit`)
  redirect(`/admin/series/${seriesId}/edit`)
}

/**
 * Entfernt die Mitgliedschaft eines Nutzer-Kontos in einer Reihe wieder - löscht NICHT
 * das Konto selbst, nur die Zuordnung zu dieser einen Reihe.
 */
export async function removeGuestUserFromSeries(formData: FormData) {
  const user = await requireUser()
  const membershipId = formData.get('membershipId') as string

  const membership = await prisma.guestUserSeries.findUnique({ where: { id: membershipId }, include: { series: true } })
  if (!membership || !(await hasSeriesModeratorOrAbove(user, membership.series))) return

  await prisma.guestUserSeries.delete({ where: { id: membershipId } })
  revalidatePath(`/admin/series/${membership.seriesId}/edit`)
}

/**
 * Löscht ein Benutzerkonto unwiderruflich inkl. aller eigenen Events, Reihen, Antworten
 * und Gast-Profile (gleiche Kaskade wie deleteEventSeries) sowie aller geteilten
 * Zugriffsrechte. Nur Admins dürfen das, und AUSDRÜCKLICH NIE ein anderes Admin-Konto -
 * so kann niemand versehentlich den letzten funktionierenden Admin-Zugang verlieren.
 */
export async function deleteUser(formData: FormData) {
  const user = await requireUser()
  if (user.role !== 'ADMIN') return

  const targetId = formData.get('userId') as string
  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target || target.role === 'ADMIN') return

  const ownSeries = await prisma.eventSeries.findMany({ where: { ownerId: targetId }, select: { id: true } })
  const seriesIds = ownSeries.map(s => s.id)
  const ownEvents = await prisma.event.findMany({ where: { ownerId: targetId }, select: { id: true } })
  const eventIds = ownEvents.map(e => e.id)

  await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } })
  await prisma.resourceAccess.deleteMany({
    where: { OR: [{ userId: targetId }, { eventId: { in: eventIds } }, { seriesId: { in: seriesIds } }] }
  })
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { seriesId: { in: seriesIds } } } })
  await prisma.participant.deleteMany({ where: { seriesId: { in: seriesIds } } })
  await prisma.eventSeries.deleteMany({ where: { id: { in: seriesIds } } })
  await prisma.pushSubscription.deleteMany({ where: { userId: targetId } })
  await prisma.session.deleteMany({ where: { userId: targetId } })
  await prisma.user.delete({ where: { id: targetId } })

  revalidatePath('/admin/users')
}
