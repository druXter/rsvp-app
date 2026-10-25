// app/admin/actions.ts
'use server' // Deklariert diese Datei als reine Backend-Logik (Server Actions)

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { type PushSubscriptionInput, validPushSubscription } from 'suite-kit/web'
import { revalidatePath } from 'next/cache'
import { Prisma, Role, type Event, type EventSeries, type Participant, type Rsvp } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'
import { sanitizeNextPath } from 'suite-kit'
import { sendReminderEmail, sendWaitlistPromotedEmail, sendConfirmationEmail, sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeConfirmation, sendPaymentReceivedEmail, sendPaymentCancelledEmail } from '../lib/mail'
import { getCurrentUser, requireUser, createSession, destroySession, SESSION_COOKIE } from '../lib/auth'
import { createGuestSession, createLinkedGuestSession, destroyLinkedGuestSession } from '../lib/guest-auth'
import { generateToken, hashToken } from '../lib/tokens'
import { generateAdminApiToken, hashApiToken, NEW_ADMIN_API_TOKEN_COOKIE } from '../lib/api-auth'
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../lib/password'
import { formPassword, formString } from '../lib/form'
import { clearFailures, clientIp, loginRules, passwordChangeRule, refund, reserve, resetRules } from '../lib/throttle'
import { isOwnerOrAdmin, hasEventModeratorOrAbove, hasSeriesModeratorOrAbove } from '../lib/permissions'
import { sendReminderPush } from '../lib/push'
import { notifyAttendeesOfChange } from '../lib/event-change-notify'
import { readToolLinks, saveToolLinks, storedToolUrl, TOOL_LINKS, type ToolLinkInput } from '../lib/linked-tools-store'
import { createLinkedEvent, isCreatableTool } from '../lib/linked-create'
import { inviteAccounts } from '../lib/guest-invites'
import { parsePhotoUrl } from '../lib/photo-link'
import { readFeedbackSettings } from '../lib/feedback-link'
import { readAssemblySettings } from '../lib/assembly'
import { readProtocolSettings } from '../lib/timeline-protocol'
import { applyBringTemplate, formatBringSlots, readBringSlots, readBringTemplate, saveBringSlots } from '../lib/bring-list'
import { notifyLinkedToolsBeforeDelete, notifyLinkedToolsOfRsvps } from '../lib/linked-tools-notify'
import { deleteOrphanedParticipants } from '../lib/participants'
import { assertCategoriesRemovable, readTicketCategories, saveTicketCategories, type TicketCategoryInput } from '../lib/tickets'
import { generatePaymentReference, paymentDue, paymentState, readPaymentSettings, syncPaymentDue, type PaymentSettings } from '../lib/payment'
import { fillFreeSeats } from '../lib/waitlist'
import { BANK_IMPORT_MAX_BYTES, decodeStatement } from '../lib/bank-import'
import { buildImportPreview, type ImportPreview } from '../lib/payment-import'
import { sendPaymentRemindersForEvent } from '../lib/payment-reminder'
import { companionsOf, MAX_COMPANIONS, menuOf, readCompanions, seatsOf } from '../lib/persons'
import { courseOptions, readMenu, readMenuSelection, validSelection } from '../lib/menu'
import { assertMenuChangeable, saveMenu } from '../lib/menu-store'
import { parseDeadline } from '../lib/rsvp-deadline'
import { EVENT_PRESETS, presetOf, slugify } from '../lib/event-presets'
import { savePersons } from '../lib/rsvp-submission'
import { checkInAll, checkOutAll, toggleAll, togglePerson, undoLastPresence } from '../lib/checkin'
import { resetInvitationReminders } from '../lib/invitation-reminder'
import { invitationCovers } from '../lib/invitation-store'
import { InputError } from '../lib/input-error'
import { readShiftTiers, storedTiers, type ShiftTierInput } from '../lib/shift-helpers'


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
 * "Begleitungen pro Anmeldung: bis zu N" (docs/KONZEPT-EINLADUNGEN.md), 0 bis MAX_COMPANIONS. Ersetzt die
 * frühere Checkbox askPlusOne in formConfig. undefined, wenn das Formular das Feld nicht hat (bleibt unverändert).
 */
function readMaxCompanions(formData: FormData): number | undefined {
  if (!formData.has('maxCompanions')) return undefined
  const value = parseInt(formString(formData, 'maxCompanions', 10), 10)
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_COMPANIONS) : 0
}

/**
 * Begleitungen und Ticketkategorien schließen sich aus (docs/KONZEPT-EINLADUNGEN.md): Bei Kategorien meldet sich
 * jede Person selbst an, damit Kategorie, Betrag und Einlass pro Person stimmen. Wirft, bevor etwas gespeichert ist.
 */
async function assertCompanionsAllowed(maxCompanions: number | undefined, categories: TicketCategoryInput[] | null, eventId: string | null) {
  const companions = maxCompanions ?? (eventId ? (await prisma.event.findUnique({ where: { id: eventId }, select: { maxCompanions: true } }))?.maxCompanions ?? 0 : 0)
  if (companions === 0) return
  const hasCategories = categories ? categories.length > 0 : !!eventId && (await prisma.ticketCategory.count({ where: { eventId } })) > 0
  if (hasCategories) throw new InputError('Begleitungen und Ticketkategorien schließen sich aus: Bei Kategorien meldet sich jede Person selbst an. Bitte eines von beiden entfernen.')
}

/**
 * Einladungsmodus (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): für Einzel-Events und Reihen, nicht zusammen mit PIN,
 * Konto-Pflicht, E-Mail-Verifizierung oder Ticketkategorien - der persönliche Link ersetzt diese Zugänge, und
 * Kategorien gelten pro Person. Wirft, bevor etwas gespeichert ist.
 */
async function assertInviteOnlyAllowed(
  inviteOnly: boolean,
  settings: { eventPin: string | null; requireVerification: boolean; requireGuestUser: boolean },
  categories: TicketCategoryInput[] | null,
  target: { eventId: string } | { seriesId: string } | null
) {
  if (!inviteOnly) return
  // Kategorien aus dem Formular, sonst die gespeicherten des Termins bzw. aller Termine der Reihe
  const hasCategories = categories
    ? categories.length > 0
    : !!target && (await prisma.ticketCategory.count({ where: 'seriesId' in target ? { event: { seriesId: target.seriesId } } : { eventId: target.eventId } })) > 0
  const conflicts = [
    settings.eventPin && 'PIN',
    settings.requireVerification && 'E-Mail-Verifizierung',
    settings.requireGuestUser && 'Teilnehmendenkonto-Pflicht',
    hasCategories && 'Ticketkategorien'
  ].filter(Boolean)
  if (conflicts.length > 0) throw new InputError(`Einladungsmodus: nicht zusammen mit ${conflicts.join(', ')}. Der persönliche Link ersetzt diese Zugänge.`)
}

/**
 * Antwortfrist und Erinnerung an Einladungen ohne Antwort (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 5). Felder, die
 * das Formular nicht hat, bleiben unverändert (undefined). Die Erinnerung braucht eine Frist. Wirft, bevor etwas
 * gespeichert ist.
 */
function readDeadlineSettings(formData: FormData): { rsvpDeadline?: Date | null; rsvpReminderDays?: number | null } {
  const result: { rsvpDeadline?: Date | null; rsvpReminderDays?: number | null } = {}
  if (formData.has('rsvpDeadline')) result.rsvpDeadline = parseDeadline(formString(formData, 'rsvpDeadline', 20))
  if (formData.has('rsvpReminderDays')) {
    const raw = formString(formData, 'rsvpReminderDays', 5)
    const days = raw ? Number(raw) : null
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 60)) throw new InputError('Erinnerung an Einladungen: 1 bis 60 Tage vor der Frist.')
    if (days !== null && formData.has('rsvpDeadline') && !result.rsvpDeadline) throw new InputError('Erinnerung an Einladungen: Bitte zuerst eine Antwortfrist eintragen.')
    result.rsvpReminderDays = days
  }
  return result
}

export type SettingsState = { error: string } | null

/**
 * Speichern der Einstellungen (Event, Termin, Reihe) für app/admin/settings-form.tsx: Ungültige Eingaben
 * (InputError) und ein schon vergebenes URL-Wort kommen als Meldung zurück ans Formular, alles bleibt wie
 * eingegeben. `save` gibt das Ziel nach dem Speichern zurück (undefined = kein Zugriff, nichts passiert).
 */
async function settingsResult(save: () => Promise<string | undefined>): Promise<SettingsState> {
  let target: string | undefined
  try {
    target = await save()
  } catch (error) {
    if (error instanceof InputError) return { error: error.message }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && String(error.meta?.target).includes('slug')) {
      return { error: 'Diese Adresse (URL-Wort) ist schon vergeben. Bitte ein anderes wählen.' }
    }
    throw error
  }
  if (target) redirect(target)
  return null
}

/**
 * Stufen für Helfer-Zusagen aus Schichten (app/lib/shift-helpers.ts) - Kategorien aus dem Formular, sonst die
 * gespeicherten. Wirft, bevor etwas gespeichert ist; gespeichert wird nach den Kategorien (saveShiftTiers).
 */
async function readShiftSettings(formData: FormData, eventId: string, ticketing: { ticketCategories: { label: string }[] | null }) {
  const labels = ticketing.ticketCategories
    ? ticketing.ticketCategories.map(c => c.label)
    : (await prisma.ticketCategory.findMany({ where: { eventId }, select: { label: true }, orderBy: { position: 'asc' } })).map(c => c.label)
  return readShiftTiers(formData, labels)
}

async function saveShiftTiers(eventId: string, tiers: ShiftTierInput[] | undefined) {
  if (tiers === undefined) return
  const categories = await prisma.ticketCategory.findMany({ where: { eventId }, select: { id: true, label: true } })
  await prisma.event.update({ where: { id: eventId }, data: { shiftTiers: storedTiers(tiers, categories) } })
}

/** Helfer-Zusagen gibt es nicht im Einladungsmodus (dort antwortet nur, wer eine Einladung hat). */
function assertShiftsAllowed(inviteOnly: boolean, toolLinks: ToolLinkInput[]) {
  if (inviteOnly && toolLinks.some(l => l.type === 'shifts' && l.link)) {
    throw new InputError('Schichten: Helfer-Zusagen gehen nicht zusammen mit „Nur mit Einladung“. Bitte eins von beiden entfernen.')
  }
}

/** Wunschliste an/aus und "Überraschung" (docs/KONZEPT-WUNSCHLISTE.md) - nur, wenn das Formular den Abschnitt hatte. */
function readWishlistSettings(formData: FormData): { wishlist?: boolean; wishesSecret?: boolean } {
  if (!formData.has('wishlistShown')) return {}
  return { wishlist: formData.get('wishlist') === 'on', wishesSecret: formData.get('wishesSecret') === 'on' }
}

/** Neue Antwortfrist: Erinnerungen an Einladungen gehen für die neue Frist noch einmal. */
async function resetRemindersOnNewDeadline(eventId: string, before: Date | null, after: Date | null | undefined) {
  if (after !== undefined && (before?.getTime() ?? null) !== (after?.getTime() ?? null)) await resetInvitationReminders(eventId)
}

/**
 * Liest die optionalen Felder für einen externen Abstimmungs-Link (Event.pollUrl/
 * pollLabel, siehe schema.prisma und app/api/poll-link/[eventId]/route.ts) - leere
 * Felder werden zu null statt leerem String, gleiche Konvention wie eventPin.
 */
function readPollLink(formData: FormData): { pollUrl: string | null; pollLabel: string | null; datePending: boolean } {
  const pollUrlInput = (formData.get('pollUrl') as string || '').trim()
  const pollLabelInput = (formData.get('pollLabel') as string || '').trim()
  return {
    pollUrl: pollUrlInput || null,
    pollLabel: pollLabelInput || null,
    // "Datum noch offen" ergibt nur mit einer verknüpften Terminabstimmung Sinn - ohne
    // pollUrl könnte nie jemand das Datum festlegen (siehe Event.datePending).
    datePending: !!pollUrlInput && formData.get('datePending') === 'on'
  }
}

/**
 * Tickets und Bezahlung aus dem Termin-Formular (docs/KONZEPT-TICKETS.md): Kategorien, Zahlungseinstellungen
 * und der Seating-Schalter "erst nach Zahlung". Wirft, BEVOR etwas gespeichert ist (ungültige Zeile, IBAN,
 * fehlendes Konto bei Preisen, Kategorie mit Antworten entfernt). Fehlt ein Abschnitt im Formular, bleibt er
 * unangetastet (null bzw. undefined).
 */
async function readTicketing(formData: FormData, eventId: string | null): Promise<{
  ticketCategories: TicketCategoryInput[] | null
  payment: PaymentSettings | null
  seatingRequiresPayment: boolean | undefined
}> {
  const ticketCategories = readTicketCategories(formData)
  const needsPayment = ticketCategories
    ? ticketCategories.some(c => c.priceCents > 0)
    : !!eventId && (await prisma.ticketCategory.count({ where: { eventId, priceCents: { gt: 0 } } })) > 0
  const payment = readPaymentSettings(formData, needsPayment)
  if (eventId) await assertCategoriesRemovable(eventId, ticketCategories)
  const seatingRequiresPayment = formData.has('seatingRequiresPaymentShown') ? formData.get('seatingRequiresPayment') === 'on' : undefined
  return { ticketCategories, payment, seatingRequiresPayment }
}

/** Nach dem Speichern eines Termins: Kategorien, Frist, Nachrücken und ggf. neuer Stand für Seating. */
async function applyTicketing(eventId: string, ticketing: Awaited<ReturnType<typeof readTicketing>>, seatingGateChanged: boolean) {
  await saveTicketCategories(eventId, ticketing.ticketCategories)
  // Neue Frist gilt auch für schon offene Zusagen ohne Frist
  await syncPaymentDue({ eventId })
  // Höhere Kapazität oder größere Kontingente lassen Wartende nachrücken
  await fillFreeSeats(eventId)
  // "Sitzplatzwahl erst nach Zahlung" umgeschaltet: Seating bekommt für alle Zusagen den neuen Stand
  if (seatingGateChanged) {
    const rsvps = await prisma.rsvp.findMany({ where: { eventId }, select: { id: true } })
    notifyLinkedToolsOfRsvps(rsvps.map(r => r.id))
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
 * Prüft E-Mail/Passwort gegen die Datenbank und erstellt bei Erfolg eine server-seitige Session
 * (Cookie enthält nur den opaken Token, siehe app/lib/auth.ts). Sicherheitsverhalten, das hier
 * bewusst so ist:
 * - Drosselung nach IP UND nach Ziel-E-Mail (siehe app/lib/throttle.ts). Der Versuch wird VOR der
 *   Passwortprüfung atomar reserviert - so lässt sich das Limit auch mit vielen gleichzeitigen
 *   Anfragen nicht umgehen, und ein gesperrter Versuch kostet keine Rechenlast.
 * - Bei unbekannter E-Mail (oder einem Konto ohne Passwort, das nur über ein anderes Tool
 *   angemeldet wird) rechnet eine gleich teure Prüfung gegen einen Wegwerf-Hash und dieselbe
 *   Fehlermeldung erscheint - weder Antwortzeit noch Text verraten, welche Adressen ein Konto haben.
 * - Nach dem Login gilt immer eine NEUE Session (siehe issueSession).
 */
export async function loginUser(formData: FormData) {
  const email = formString(formData, 'email', 254).toLowerCase()
  const password = formPassword(formData, 'password')
  const next = sanitizeNextPath(formString(formData, 'next', 1000), '/admin')
  const nextParam = next !== '/admin' ? `&next=${encodeURIComponent(next)}` : ''

  const rules = loginRules(await clientIp(), email)
  if (!(await reserve([rules.ip, rules.email]))) {
    redirect(`/admin/login?error=locked${nextParam}`)
  }

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null

  let userId: string | null = null
  if (user?.passwordHash) {
    const check = await verifyPassword(password, user.passwordHash)
    if (check.ok) {
      userId = user.id
      // Ältere, schwächere Hashes (bcrypt-Kosten 10) beim erfolgreichen Login automatisch erneuern.
      if (check.needsRehash) {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      }
    }
  } else {
    await verifyAgainstDummy(password)
  }

  // Fehlversuch: der Versuch ist bereits mitgezählt (reserve), hier bleibt nur die Meldung.
  if (!userId) redirect(`/admin/login?error=1${nextParam}`)

  // Erfolg: Der Versuch wird zurückgegeben (IP-Zähler) bzw. der Zähler zurückgesetzt (E-Mail).
  await refund(rules.ip)
  await clearFailures([rules.email])
  await createSession(userId)
  await createLinkedGuestSession(userId) // verknüpftes Teilnehmendenkonto gleich mit anmelden

  // Geht der Login im Anbieter-Ablauf für ein anderes Tool weiter, braucht es einen echten
  // Seitenwechsel statt eines Client-Router-Übergangs (siehe app/admin/login/weiter).
  if (next.startsWith('/api/suite/authorize?')) redirect(`/admin/login/weiter?to=${encodeURIComponent(next)}`)
  redirect(next)
}

/**
 * Beendet die Sitzung: löscht die Session in der Datenbank und das Cookie. Ist ein Teilnehmendenkonto
 * verknüpft, endet dessen Sitzung in diesem Browser mit - der Login hat sie ja auch mit geöffnet.
 */
export async function logoutUser() {
  const user = await getCurrentUser()
  await destroySession()
  await destroyLinkedGuestSession(user?.linkedGuestUserId ?? null)
  // local=1: Mit SUITE_LOGIN_REDIRECT wäre man sonst über den bevorzugten Anbieter sofort wieder angemeldet.
  redirect('/admin/login?local=1')
}

const RESET_TOKEN_DURATION_MS = 1000 * 60 * 60 // 1 Stunde

/**
 * Fordert einen Passwort-Reset per E-Mail an. Zeigt IMMER dieselbe neutrale Bestätigung
 * (Weiterleitung zu ?sent=1) - unabhängig davon, ob die E-Mail überhaupt zu einem Konto
 * gehört, ob es ein Admin-Konto ist oder ob die Anfrage gedrosselt wurde, damit weder die
 * Existenz eines Kontos noch dessen Admin-Status über das Antwortverhalten verraten wird. Für
 * Admin-Konten wird bewusst NIE ein Reset-Token vergeben (siehe #13/#5) - dort bleibt ein Reset
 * ausschließlich über direkten Server-Zugriff (create-user.js/set-role.js) möglich, damit ein
 * kompromittiertes Admin-Postfach nicht automatisch vollen Zugriff gibt. Konten ohne Passwort
 * (nur über ein anderes Tool angemeldet) haben nichts zurückzusetzen.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = formString(formData, 'email', 254).toLowerCase()

  if (email) {
    // Jede Anfrage zählt (auch für unbekannte Adressen) - sonst ließe sich über die Drosselung
    // erkennen, welche Adressen ein Konto haben - und niemand kann fremde Postfächer mit Mails fluten.
    if (await reserve(resetRules(await clientIp(), email))) {
      const user = await prisma.user.findUnique({ where: { email } })
      if (user && user.passwordHash && user.role !== 'ADMIN') {
        const token = generateToken()
        await prisma.user.update({
          where: { id: user.id },
          data: { resetToken: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MS) }
        })
        // Nicht abwarten: Sonst wäre die Antwort bei existierender Adresse merklich langsamer.
        sendPasswordResetEmail(user, token).catch(error => console.error('Fehler beim Senden der Passwort-Reset-Mail:', error))
      }
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
  const token = formString(formData, 'token', 200)
  const password = formPassword(formData, 'password')

  const user = token ? await prisma.user.findUnique({ where: { resetToken: hashToken(token) } }) : null
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    redirect('/admin/reset-password?error=invalid')
  }

  if (validatePassword(password, user.email)) {
    redirect(`/admin/reset-password?token=${encodeURIComponent(token)}&error=weak`)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), resetToken: null, resetTokenExpiresAt: null }
  })
  await prisma.session.deleteMany({ where: { userId: user.id } })

  redirect('/admin/login?reset=1')
}

/**
 * Ändert das Passwort eines bereits eingeloggten Kontos (jeder Rolle, inkl. Admin) -
 * erfordert das aktuelle Passwort statt eines Mail-Links. Anders als der Reset per
 * Mail-Link (siehe requestPasswordReset, für Admin-Konten ausgeschlossen) reicht dafür
 * ein kompromittiertes Postfach nicht aus - es braucht zusätzlich eine aktive Session,
 * daher ist das auch für Admin-Konten sicher. Die Abfrage des aktuellen Passworts ist gedrosselt
 * (Schutz gegen eine gekaperte Sitzung). Invalidiert alle ANDEREN Sessions dieses Kontos, damit
 * ein evtl. gestohlenes altes Passwort keinen dauerhaften Zugriff behält, meldet die aktuelle
 * Sitzung aber nicht ab.
 */
export async function changePassword(formData: FormData) {
  const user = await requireUser()

  const rule = passwordChangeRule(user.id)
  if (!(await reserve([rule]))) redirect('/admin/account?error=locked')
  if (!user.passwordHash) redirect('/admin/account?error=nopassword')

  const check = await verifyPassword(formPassword(formData, 'currentPassword'), user.passwordHash)
  if (!check.ok) redirect('/admin/account?error=wrongpassword') // bereits mitgezählt (reserve)

  const newPassword = formPassword(formData, 'newPassword')
  if (validatePassword(newPassword, user.email)) redirect('/admin/account?error=weak')

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } })

  const currentToken = (await cookies()).get(SESSION_COOKIE)?.value
  await prisma.session.deleteMany({
    where: { userId: user.id, ...(currentToken ? { token: { not: hashToken(currentToken) } } : {}) }
  })
  await clearFailures([rule])

  redirect('/admin/account?passwordChanged=1')
}

/**
 * Fordert eine E-Mail-Änderung an - erfordert das aktuelle Passwort (gedrosselt wie bei
 * changePassword). Die neue Adresse wird erst nach Klick auf den an SIE (nicht an die alte
 * Adresse) verschickten Bestätigungslink wirksam (siehe /admin/confirm-email). Für jede Rolle
 * inkl. Admin verfügbar, siehe changePassword für die Begründung. Konten ohne Passwort (nur über
 * ein anderes Tool angemeldet) übernehmen ihre Adresse von dort.
 */
export async function requestEmailChange(formData: FormData) {
  const user = await requireUser()

  const rule = passwordChangeRule(user.id)
  if (!(await reserve([rule]))) redirect('/admin/account?error=locked')
  if (!user.passwordHash) redirect('/admin/account?error=nopassword')

  const check = await verifyPassword(formPassword(formData, 'currentPassword'), user.passwordHash)
  if (!check.ok) redirect('/admin/account?error=wrongpassword')

  const newEmail = formString(formData, 'newEmail', 254).toLowerCase()
  if (newEmail === user.email) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) redirect('/admin/account?error=invalidemail')

  const existing = await prisma.user.findUnique({ where: { email: newEmail } })
  if (existing) {
    redirect('/admin/account?error=emailtaken')
  }

  const token = generateToken()
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      pendingEmail: newEmail,
      emailChangeToken: hashToken(token),
      emailChangeTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MS)
    }
  })
  await clearFailures([rule])

  try {
    await sendEmailChangeConfirmation(updated, token)
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
 * Entfernt die Verknüpfung mit einem Konto aus einem anderen Tool. Mindestens eine Anmeldemöglichkeit
 * (Passwort oder eine andere Verknüpfung) muss übrig bleiben, sonst sperrt sich die Person selbst aus.
 */
export async function unlinkIdentity(formData: FormData) {
  const user = await requireUser()

  const identity = await prisma.externalIdentity.findUnique({ where: { id: formString(formData, 'identityId', 50) } })
  if (!identity || identity.userId !== user.id) return

  const others = await prisma.externalIdentity.count({ where: { userId: user.id, id: { not: identity.id } } })
  if (!user.passwordHash && others === 0) redirect('/admin/account?error=lastlogin')

  await prisma.externalIdentity.delete({ where: { id: identity.id } })
  redirect('/admin/account?unlinked=1')
}

/**
 * Verknüpft das eigene Verwaltungskonto mit einem Teilnehmendenkonto (GuestUser) derselben Person. Danach
 * meldet jeder Verwaltungs-Login dort mit an (nie umgekehrt, siehe User.linkedGuestUserId). Den Besitz
 * beweist das Passwort des Teilnehmendenkontos - eine Gast-Sitzung im selben Browser reicht nicht, die
 * könnte auf einem geteilten Gerät einer anderen Person gehören. Gedrosselt mit denselben Zählern wie
 * der Gast-Login, sonst ließe sich hierüber dessen Drosselung umgehen; unbekannte Adresse und falsches
 * Passwort ergeben dieselbe Meldung (siehe loginUser).
 */
export async function linkGuestAccount(formData: FormData) {
  const user = await requireUser()
  const email = formString(formData, 'guestEmail', 254).toLowerCase()
  const password = formPassword(formData, 'guestPassword')

  const rules = loginRules(await clientIp(), email, 'guest-login')
  if (!(await reserve([rules.ip, rules.email]))) redirect('/admin/account?error=guestlink-locked')

  const guestUser = email ? await prisma.guestUser.findUnique({ where: { email }, include: { linkedUser: { select: { id: true } } } }) : null
  let passwordOk = false
  if (guestUser) passwordOk = (await verifyPassword(password, guestUser.passwordHash)).ok
  else await verifyAgainstDummy(password)

  if (!guestUser || !passwordOk) redirect('/admin/account?error=guestlink-failed')
  if (!guestUser.isVerified) redirect('/admin/account?error=guestlink-unverified')
  if (guestUser.linkedUser && guestUser.linkedUser.id !== user.id) redirect('/admin/account?error=guestlink-taken')

  await refund(rules.ip)
  await clearFailures([rules.email])
  await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: guestUser.id } })
  await createGuestSession(guestUser.id)

  redirect('/admin/account?guestLinked=1')
}

/** Löst die Verknüpfung mit dem Teilnehmendenkonto. Beide Konten und ihre Sitzungen bleiben bestehen. */
export async function unlinkGuestAccount() {
  const user = await requireUser()
  await prisma.user.update({ where: { id: user.id }, data: { linkedGuestUserId: null } })
  redirect('/admin/account?guestUnlinked=1')
}

/**
 * Erzeugt einen Token für die lesende Verwaltungs-API (app/api/v1/verwaltung/). Wie createApiToken in
 * app/mein-konto/actions.ts: gespeichert wird nur der Hash, der Klartext liegt eine Minute in einem httpOnly-Cookie
 * (nur unter /admin), damit die Konto-Seite ihn einmal anzeigen kann. Der Token hat keine eigenen Rechte, sondern
 * die des Kontos zum Zeitpunkt jeder Anfrage.
 */
export async function createAdminApiToken(formData: FormData) {
  const user = await requireUser()
  const name = formString(formData, 'name', 60) || 'Unbenannt'

  const token = generateAdminApiToken()
  await prisma.userApiToken.create({ data: { name, tokenHash: hashApiToken(token), userId: user.id } })
  ;(await cookies()).set(NEW_ADMIN_API_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60,
    path: '/admin',
  })

  redirect('/admin/account?tokenCreated=1')
}

/** Widerruft einen eigenen Verwaltungs-Token (fremde Token-IDs bewirken nichts). */
export async function revokeAdminApiToken(formData: FormData) {
  const user = await requireUser()
  await prisma.userApiToken.deleteMany({ where: { id: formString(formData, 'tokenId', 50), userId: user.id } })
  redirect('/admin/account?tokenRevoked=1')
}

/**
 * Legt ein neues Benutzerkonto an (z.B. für ein anderes Referat, einen Freund oder
 * einen Moderator). Es gibt keine öffentliche Registrierung - nur bereits eingeloggte
 * Nutzer (außer Moderatoren) können weitere Konten anlegen. Nur Admins dürfen dabei
 * die Rolle CREATOR oder ADMIN vergeben - alle anderen Anfragen werden auf MODERATOR
 * heruntergestuft, damit nicht jeder Creator beliebig neue eigenständige Mandanten
 * (Creator-Konten) erzeugen kann. Das Passwort muss der Passwort-Regel entsprechen (siehe
 * app/lib/password.ts).
 */
export async function createUser(formData: FormData) {
  const user = await requireUser()
  if (user.role === 'MODERATOR') return

  const email = formString(formData, 'email', 254).toLowerCase()
  const password = formPassword(formData, 'password')
  const requestedRole = formString(formData, 'role', 20) as Role
  const role: Role = (user.role === 'ADMIN' && (requestedRole === 'CREATOR' || requestedRole === 'ADMIN'))
    ? requestedRole
    : 'MODERATOR'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/admin/create-user?error=email')
  if (validatePassword(password, email)) redirect('/admin/create-user?error=weak')

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    redirect('/admin/create-user?error=exists')
  }

  await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), role } })

  revalidatePath('/admin', 'layout')
  redirect('/admin')
}

/**
 * Neues Event (docs/KONZEPT-OBERFLAECHE.md): nur Grunddaten und eine Art (app/lib/event-presets.ts), die passende
 * Grundeinstellungen setzt. Danach geht es auf die Event-Seite - zu den Einladungen bzw. in den passenden
 * Abschnitt der Einstellungen. Ohne URL-Wort wird eines aus dem Titel gebildet (bei Bedarf mit -2, -3 ...).
 * requireGuestUser lässt sich nur hier setzen (siehe schema.prisma).
 */
export async function createEvent(formData: FormData) {
  const user = await requireUser()
  if (user.role === 'MODERATOR') return

  const title = formString(formData, 'title', 200)
  if (!title) throw new Error('Bitte einen Titel eintragen.')
  const date = new Date(formString(formData, 'date', 30))
  if (Number.isNaN(date.getTime())) throw new Error('Bitte Datum und Uhrzeit eintragen.')
  const location = formString(formData, 'location', 300) || null
  const description = formString(formData, 'description', 10_000) || null
  const duration = parseInt(formString(formData, 'duration', 5)) || 4
  const maxCapStr = formString(formData, 'maxCapacity', 10)
  const maxCapacity = maxCapStr ? parseInt(maxCapStr) || null : null
  const requireGuestUser = formData.get('requireGuestUser') === 'on'
  const presetKey = presetOf(formData.get('preset'))
  const preset = EVENT_PRESETS[presetKey]
  await assertInviteOnlyAllowed(preset.inviteOnly, { eventPin: null, requireVerification: false, requireGuestUser }, [], null)

  // URL-Wort: eingegeben (normalisiert) oder aus dem Titel, eindeutig gemacht
  const base = formString(formData, 'slug', 100) ? slugify(formString(formData, 'slug', 100)) : slugify(title)
  let slug = base
  for (let i = 2; await prisma.event.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`

  const created = await prisma.event.create({
    data: {
      ownerId: user.id,
      title,
      slug,
      date,
      location,
      description,
      duration,
      maxCapacity,
      requireGuestUser,
      formConfig: JSON.stringify({ ...preset.formConfig, customQuestions: [] }),
      maxCompanions: preset.maxCompanions,
      inviteOnly: preset.inviteOnly,
      isGuestListVisible: preset.isGuestListVisible,
      enableCheckin: preset.enableCheckin,
      trackPresence: preset.trackPresence,
      wishlist: preset.wishlist
    }
  })
  // Gleich eingeladene Teilnehmendenkonten (app/lib/guest-invites.ts; im Einladungsmodus wirkungslos)
  const inviteIds = formData.getAll('inviteGuestUser').filter((v): v is string => typeof v === 'string').slice(0, 1000)
  await inviteAccounts(user, { ...created, series: null }, inviteIds, formData.get('notifyInvites') === 'on')

  revalidatePath('/admin', 'layout')
  redirect(preset.next.tab === 'einladungen'
    ? `/admin/events/${created.id}/einladungen`
    : `/admin/events/${created.id}/einstellungen?neu=1&abschnitt=${preset.next.section}`)
}

/**
 * Löscht ein Event mitsamt aller zugehörigen Antworten aus der Datenbank. Participants, die
 * dadurch keine Antwort mehr haben, werden sofort mitgelöscht (deleteOrphanedParticipants) -
 * wer bei einer Reihe noch zu einem anderen Termin geantwortet hat, bleibt erhalten.
 */
export async function deleteEvent(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('eventId') as string

  const event = await prisma.event.findUnique({ where: { id } })
  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return

  // Verknüpfte Tools (z.B. Seating) erfahren, dass diese Zusagen wegfallen - vor dem Löschen gelesen
  await notifyLinkedToolsBeforeDelete({ eventId: id })
  const affectedParticipants = [
    ...await prisma.rsvp.findMany({ where: { eventId: id }, select: { participantId: true } }),
    // Eingeladene Haushalte ohne Antwort (ihre Einladung geht mit dem Event)
    ...await prisma.invitation.findMany({ where: { eventId: id }, select: { participantId: true } })
  ]

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

  // 3. Gäste ohne weitere Antwort nicht bis zum nächsten Cron-Lauf liegen lassen
  await deleteOrphanedParticipants(affectedParticipants.map(r => r.participantId))

  revalidatePath('/admin', 'layout')
  // Die Event-Seite gibt es nicht mehr - zurück zur Übersicht bzw. zur Reihe
  redirect(event.seriesId ? `/admin/series/${event.seriesId}` : '/admin')
}

/**
 * Aktualisiert die Meta-Daten und die Formular-Konfiguration eines bestehenden Events.
 */
export async function updateEvent(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  return settingsResult(() => saveEvent(formData))
}

async function saveEvent(formData: FormData): Promise<string | undefined> {
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
  const trackPresence = enableCheckin && formData.get('trackPresence') === 'on'
  const notifyGuests = formData.get('notifyGuests') === 'on'
  const { pollUrl, pollLabel, datePending } = readPollLink(formData)
  const photoUrl = parsePhotoUrl(formData.get('photoUrl') as string || '')
  const feedback = readFeedbackSettings(formData)
  const assembly = await readAssemblySettings(formData, { id, title, assemblyUrl: existingEvent.assemblyUrl })
  const bringSlots = readBringSlots(formData)
  const toolLinks = readToolLinks(formData)
  const ticketing = await readTicketing(formData, id)
  const shiftTiers = await readShiftSettings(formData, id, ticketing)
  const maxCompanions = readMaxCompanions(formData)
  await assertCompanionsAllowed(maxCompanions, ticketing.ticketCategories, id)
  const menu = readMenu(formData)
  await assertMenuChangeable(id, menu)
  const deadline = readDeadlineSettings(formData)
  // Einladungsmodus nur über das Bearbeiten-Formular eines Einzel-Events (Feld fehlt = unverändert)
  const inviteOnly = formData.has('inviteOnlyShown') ? formData.get('inviteOnly') === 'on' : existingEvent.inviteOnly
  await assertInviteOnlyAllowed(inviteOnly, { eventPin, requireVerification, requireGuestUser: existingEvent.requireGuestUser }, ticketing.ticketCategories, { eventId: id })
  assertShiftsAllowed(inviteOnly, toolLinks)

  const formConfig = JSON.stringify({
    askEmail: formData.get('askEmail') === 'on',
    askPhone: formData.get('askPhone') === 'on',
    askDiet: formData.get('askDiet') === 'on',
    askAlcohol: formData.get('askAlcohol') === 'on',
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
      trackPresence,
      pollUrl,
      pollLabel,
      photoUrl,
      datePending,
      maxCompanions,
      inviteOnly,
      ...feedback,
      ...assembly,
      ...readProtocolSettings(formData),
      ...deadline,
      ...readWishlistSettings(formData),
      ...(ticketing.payment ?? {}),
      ...(ticketing.seatingRequiresPayment !== undefined ? { seatingRequiresPayment: ticketing.seatingRequiresPayment } : {}),
      ...(changes.length > 0 ? { icsSequence: { increment: 1 } } : {})
    }
  })
  // Geänderter oder entfernter Link leert, was das bisherige Tool-Event gemeldet hat (z.B. Plätze)
  await saveToolLinks(id, toolLinks)
  await saveBringSlots(id, bringSlots)
  await saveMenu(id, menu)
  await resetRemindersOnNewDeadline(id, existingEvent.rsvpDeadline, deadline.rsvpDeadline)
  await applyTicketing(id, ticketing, ticketing.seatingRequiresPayment !== undefined && ticketing.seatingRequiresPayment !== existingEvent.seatingRequiresPayment)
  await saveShiftTiers(id, shiftTiers)

  if (notifyGuests && changes.length > 0) {
    await notifyAttendeesOfChange(id, changes)
  }

  revalidatePath('/admin', 'layout')
  return `/admin/events/${id}/einstellungen?gespeichert=1`
}

/**
 * Knopf „Im Zeitplan anlegen“ bzw. „In Schichten anlegen“ unter „Verknüpfungen“ (Idee Q1, app/lib/linked-create.ts):
 * Das Tool legt ein verknüpftes Event an, hier wird der Link eingetragen. Nur Owner und Admins, nur ohne bestehende
 * Verknüpfung; Schichten nicht im Einladungsmodus (wie beim Eintragen von Hand). Ergebnis als Hinweis auf der Seite.
 */
export async function createLinkedToolEvent(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('eventId') as string
  const type = formData.get('tool')
  if (!id || !isCreatableTool(type)) return
  const event = await prisma.event.findUnique({ where: { id }, include: { toolLinks: TOOL_LINKS } })
  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return

  const back = (query: string) => redirect(`/admin/events/${id}/einstellungen?abschnitt=verknuepfungen&tool=${type}&${query}`)
  if (storedToolUrl(event.toolLinks, type)) back('anlegen=schon')
  if (type === 'shifts' && event.inviteOnly) back('anlegen=einladung')

  const result = await createLinkedEvent(type, event, user.id)
  revalidatePath('/admin', 'layout')
  if (!result) back('anlegen=fehler')
  else if (result.status === 'created' || result.status === 'linked') back(`angelegt=${result.status}`)
  else back(`anlegen=${result.status}`)
}

/**
 * Löscht eine spezifische Antwort (RSVP) eines Gastes zu einem Termin.
 * Der Participant (das Profil) bleibt nur bestehen, falls er noch andere Antworten hat -
 * sonst wird er sofort mitgelöscht (deleteOrphanedParticipants).
 */
export async function deleteRsvp(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string

  const rsvpToDelete = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvpToDelete || !(await hasEventModeratorOrAbove(user, rsvpToDelete.event))) return

  await notifyLinkedToolsBeforeDelete({ id })
  await prisma.rsvp.delete({
    where: { id }
  })
  await deleteOrphanedParticipants([rsvpToDelete.participantId])

  if (rsvpToDelete.isAttending && !rsvpToDelete.isOnWaitlist) {
    await fillFreeSeats(rsvpToDelete.eventId)
  }

  revalidatePath('/admin', 'layout')
}

/**
 * Ermöglicht es dem Administrator, die Antwort eines Gastes zu einem Termin manuell
 * zu bearbeiten - inklusive der reihenweit geteilten Profildaten (Name, Kontakt, Essen).
 */
export async function updateAdminRsvp(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string
  const name = formData.get('name') as string
  const requestedAttending = formData.get('isAttending') === 'true'

  const email = formData.get('email') as string || null
  const phone = formData.get('phone') as string || null
  const dietaryOption = formData.get('dietaryOption') as string || null
  const allergies = formData.get('allergies') as string || null

  const drinksAlcohol = formData.has('drinksAlcohol') ? formData.get('drinksAlcohol') === 'true' : null
  const additionalInfo = formData.get('additionalInfo') as string || null
  const declineReason = formData.get('declineReason') as string || null

  const companionsInput = readCompanions(formData)
  const bringingItem = formData.get('bringingItem') as string || null

  const existingRsvp = await prisma.rsvp.findUnique({ where: { id }, include: { persons: { orderBy: { position: 'asc' }, include: { menuChoices: true } }, event: { include: { ticketCategories: true, menuCourses: true } } } })
  if (!existingRsvp || !(await hasEventModeratorOrAbove(user, existingRsvp.event))) return

  // Ticketkategorie: Die Verwaltung darf sie jederzeit ändern, auch in eine volle (wie "Zulassen"). Vor der
  // Zahlung folgt der Betrag dem Preis der neuen Kategorie, danach bleibt der bezahlte Betrag stehen.
  const categories = existingRsvp.event.ticketCategories
  let ticketCategoryId = existingRsvp.ticketCategoryId
  if (formData.has('ticketCategoryId')) {
    const requested = categories.find(c => c.id === formData.get('ticketCategoryId'))
    if (requested) ticketCategoryId = requested.id
  }
  let amountCents = existingRsvp.amountCents
  if (ticketCategoryId !== existingRsvp.ticketCategoryId && !existingRsvp.paidAt) {
    amountCents = categories.find(c => c.id === ticketCategoryId)?.priceCents ?? null
  }
  const paymentReference = existingRsvp.paymentReference ?? (amountCents ? generatePaymentReference(existingRsvp.event.slug) : null)
  // Begleitungen (docs/KONZEPT-EINLADUNGEN.md): Die Verwaltung darf über das Höchstmaß des Termins hinaus
  // eintragen (wie "Zulassen", ohne Platzprüfung), nur nicht bei Ticketkategorien. Das Menü muss sie nicht
  // vollständig wählen, gespeichert wird nur, was es im Menü des Termins gibt.
  const menu = existingRsvp.event.menuCourses.map(c => ({ id: c.id, label: c.label, options: courseOptions(c.options) }))
  // Antwort eines eingeladenen Haushalts: Personen und Zu-/Absage bleiben, wie der Haushalt sie gesetzt hat
  const invitation = await prisma.invitation.findUnique({ where: { participantId: existingRsvp.participantId }, include: { events: { select: { eventId: true } } } })
  const isHousehold = !!invitation && invitationCovers(invitation, existingRsvp.event)
  const isAttending = isHousehold ? existingRsvp.isAttending : requestedAttending
  const usesPersons = !isHousehold && ((categories.length === 0 && existingRsvp.event.maxCompanions > 0) || existingRsvp.persons.length > 0 || menu.length > 0)
  const companions = categories.length > 0 ? [] : (companionsInput ?? companionsOf(existingRsvp.persons)).slice(0, MAX_COMPANIONS)
  const ownMenu = readMenuSelection(formData, 'menu_') ?? (existingRsvp.persons[0] ? menuOf(existingRsvp.persons[0]) : {})
  const persons = [
    { name, ageGroup: 'ADULT', isAttending, dietaryOption, allergies, menu: validSelection(menu, ownMenu), drinksAlcohol: isAttending ? drinksAlcohol : null },
    ...companions.map(c => ({ ...c, isAttending, menu: c.ageGroup === 'INFANT' ? {} : validSelection(menu, c.menu), drinksAlcohol: isAttending ? c.drinksAlcohol : null }))
  ]

  await prisma.participant.update({
    where: { id: existingRsvp.participantId },
    data: { name, email, phone, dietaryOption, allergies }
  })

  await prisma.rsvp.update({
    where: { id },
    data: {
      isAttending,
      ticketCategoryId,
      amountCents,
      paymentReference,
      drinksAlcohol: isAttending ? drinksAlcohol : null,
      additionalInfo: isAttending ? additionalInfo : null,
      bringingItem: isAttending ? bringingItem : null,
      declineReason: isAttending ? null : declineReason
    }
  })
  if (usesPersons) await savePersons(id, persons)
  await syncPaymentDue({ rsvpIds: [id] })

  // Absage gibt beanspruchte Einträge der Mitbringliste frei
  if (!isAttending) await prisma.bringClaim.deleteMany({ where: { rsvpId: id } })

  // Name/Adresse/Begleitung/Zu-/Absage können sich geändert haben
  notifyLinkedToolsOfRsvps([id])

  // Ein fester Platz wird frei (Absage, andere Kategorie oder weniger Personen): Wartende rücken nach
  const fewerSeats = usesPersons && seatsOf(persons) < seatsOf(existingRsvp.persons)
  if (existingRsvp.isAttending && !existingRsvp.isOnWaitlist && (!isAttending || ticketCategoryId !== existingRsvp.ticketCategoryId || fewerSeats)) {
    await fillFreeSeats(existingRsvp.eventId)
  }

  revalidatePath('/admin', 'layout')
  redirect(`/admin/events/${existingRsvp.eventId}/gaeste`)
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
  await prisma.rsvp.update({
    where: { id },
    data: { isOnWaitlist: false }
  })
  // Frist ab jetzt, bevor die Bestätigung (mit Zahlungsdaten) rausgeht
  await syncPaymentDue({ rsvpIds: [id] })
  const promotedRsvp = await prisma.rsvp.findUniqueOrThrow({ where: { id } })
  notifyLinkedToolsOfRsvps([id])

  // Erfolgs-Mails senden
  if (rsvp.participant.email) {
    await sendWaitlistPromotedEmail(rsvp.participant, promotedRsvp, rsvp.event)
    await sendConfirmationEmail(rsvp.participant, promotedRsvp, rsvp.event)
  }

  revalidatePath('/admin', 'layout')
}


/**
 * Bezahlstatus einer Zusage setzen (docs/KONZEPT-TICKETS.md) - für Owner, Admins und Moderator*innen, damit
 * Helfer*innen an der Abendkasse kassieren können. Jede Aktion gilt nur im passenden Zustand und wird atomar
 * gesetzt (updateMany mit dem erwarteten Zustand in der Bedingung), damit ein Doppelklick nichts doppelt tut:
 * paid-transfer/paid-cash nur bei offener Zahlung, unpaid nur bei bezahlt (nicht erstattet), refunded und
 * refund-undo nur nach einer Absage mit Zahlung. Eine Überweisung bestätigt rsvp-app dem Gast per Mail.
 */
export async function setPaymentStatus(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string
  const action = formData.get('paymentAction') as string

  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: { include: { series: true } }, participant: true } })
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return
  const state = paymentState(rsvp)
  const now = new Date()

  let changed = 0
  if ((action === 'paid-transfer' || action === 'paid-cash') && paymentDue(rsvp)) {
    changed = await markPaid(rsvp, action === 'paid-cash' ? 'CASH' : 'TRANSFER') ? 1 : 0
  } else if (action === 'unpaid' && state === 'paid') {
    changed = (await prisma.rsvp.updateMany({ where: { id, paidAt: { not: null }, refundedAt: null }, data: { paidAt: null, paymentMethod: null } })).count
    await syncPaymentDue({ rsvpIds: [id] })
  } else if (action === 'refunded' && state === 'refund-open') {
    changed = (await prisma.rsvp.updateMany({ where: { id, refundedAt: null }, data: { refundedAt: now } })).count
  } else if (action === 'refund-undo' && state === 'refunded') {
    changed = (await prisma.rsvp.updateMany({ where: { id, refundedAt: { not: null } }, data: { refundedAt: null } })).count
  }

  // "Sitzplatzwahl erst nach Zahlung": bezahlt bzw. zurückgesetzt ändert, ob die Zusage bei Seating zählt
  if (changed === 1) notifyLinkedToolsOfRsvps([id])
  revalidatePath('/admin', 'layout')
}

/**
 * Markiert eine offene Zahlung als bezahlt - atomar (nur wenn paidAt noch leer ist), bei Überweisung mit Mail
 * "Zahlung eingegangen". Gemeinsam für den Knopf in der Gästeliste und den Kontoauszug-Import. Die Rechte
 * prüft der Aufrufer. true = diese Anfrage hat markiert.
 */
async function markPaid(
  rsvp: Rsvp & { participant: Participant; event: Event & { series: EventSeries | null } },
  method: 'TRANSFER' | 'CASH'
): Promise<boolean> {
  const now = new Date()
  const changed = await prisma.rsvp.updateMany({ where: { id: rsvp.id, paidAt: null }, data: { paidAt: now, paymentMethod: method, refundedAt: null } })
  if (changed.count !== 1) return false
  if (method === 'TRANSFER' && rsvp.participant.email) {
    try {
      await sendPaymentReceivedEmail(rsvp.participant, { ...rsvp, paidAt: now, paymentMethod: method }, rsvp.event)
    } catch (error) {
      console.error('Fehler beim Versand der Zahlungsbestätigung:', error)
    }
  }
  return true
}

export type BankImportState = { error?: string; fileName?: string; preview?: ImportPreview } | null

/**
 * Kontoauszug-Import, Schritt 1 (app/admin/events/[id]/zahlungen): liest die hochgeladene Datei NUR im Speicher
 * (nie gespeichert - sie enthält fremde Kontodaten) und liefert die Vorschau. Markiert noch nichts.
 */
export async function previewBankImport(_prev: BankImportState, formData: FormData): Promise<BankImportState> {
  const user = await requireUser()
  const eventId = formData.get('eventId') as string
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return { error: 'Kein Zugriff auf diesen Termin.' }

  const file = formData.get('statement')
  if (!(file instanceof File) || file.size === 0) return { error: 'Bitte wähle eine Datei aus.' }
  if (file.size > BANK_IMPORT_MAX_BYTES) return { error: 'Die Datei ist zu groß (höchstens 1,5 MB). Exportiere nur den Zeitraum seit dem Start der Anmeldung.' }
  const text = decodeStatement(new Uint8Array(await file.arrayBuffer()))
  return { fileName: file.name, preview: await buildImportPreview(eventId, text) }
}

/**
 * Kontoauszug-Import, Schritt 2: markiert die ausgewählten Zusagen als per Überweisung bezahlt (mit Mail).
 * Nur Zusagen DIESES Termins mit offener Zahlung - fremde oder schon bezahlte IDs werden übergangen.
 */
export async function confirmBankImport(formData: FormData) {
  const user = await requireUser()
  const eventId = formData.get('eventId') as string
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return

  const ids = [...new Set(formData.getAll('rsvpId').map(String))].slice(0, 2000)
  const rsvps = await prisma.rsvp.findMany({ where: { id: { in: ids }, eventId }, include: { participant: true, event: { include: { series: true } } } })
  const marked: string[] = []
  for (const rsvp of rsvps) {
    if (paymentDue(rsvp) && await markPaid(rsvp, 'TRANSFER')) marked.push(rsvp.id)
  }
  if (marked.length > 0) notifyLinkedToolsOfRsvps(marked)
  revalidatePath('/admin', 'layout')
  redirect(`/admin/events/${eventId}/zahlungen?markiert=${marked.length}`)
}

/** Knopf "Zahlungserinnerung senden": an alle offenen Zahlungen eines Termins (nur Owner/Admin, wie Reminder). */
export async function sendPaymentReminders(formData: FormData) {
  const user = await requireUser()
  const eventId = formData.get('eventId') as string
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !isOwnerOrAdmin(user, event.ownerId)) return
  await sendPaymentRemindersForEvent(eventId)
  revalidatePath('/admin', 'layout')
}

/**
 * Einlass mit offener Zahlung (Check-in-Seite, app/admin/checkin/[rsvpId]): "Bar kassiert - einlassen" markiert
 * bar bezahlt und checkt ein, "Ohne Zahlung einlassen" checkt nur ein. Nur für feste Plätze auf Terminen mit
 * Check-in; Rechte wie beim Scannen (Moderator*innen eingeschlossen).
 */
export async function checkInAtDoor(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string
  const mode = formData.get('mode') as string

  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return
  if (!rsvp.event.enableCheckin || !rsvp.isAttending || rsvp.isOnWaitlist) return

  if (mode === 'cash' && paymentDue(rsvp)) {
    const paid = await prisma.rsvp.updateMany({ where: { id, paidAt: null }, data: { paidAt: new Date(), paymentMethod: 'CASH' } })
    if (paid.count === 1) notifyLinkedToolsOfRsvps([id])
  }
  await checkInAll(id)

  revalidatePath(`/admin/checkin/${id}`)
  revalidatePath('/admin', 'layout')
}

/**
 * Überfällige, unbezahlte Zusage stornieren (Zahlfrist abgelaufen) - nur auf Klick, nie automatisch. Die
 * Zusage wird zur Absage, der Gast bekommt eine Mail, Wartende rücken nach. Nur im Zustand "überfällig".
 */
export async function cancelUnpaidRsvp(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string

  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: { include: { series: true } }, participant: true } })
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return
  if (paymentState(rsvp) !== 'overdue') return

  const cancelled = await prisma.rsvp.updateMany({
    where: { id, isAttending: true, isOnWaitlist: false, paidAt: null },
    // Kein Absagegrund: der stünde bei sichtbarer Gästeliste öffentlich neben dem Namen
    data: { isAttending: false, declineReason: null, paymentDueAt: null, hasAttended: false, checkedInAt: null }
  })
  if (cancelled.count !== 1) return
  await checkOutAll(id)
  await prisma.bringClaim.deleteMany({ where: { rsvpId: id } })
  notifyLinkedToolsOfRsvps([id])

  if (rsvp.participant.email) {
    try {
      await sendPaymentCancelledEmail(rsvp.participant, rsvp, rsvp.event)
    } catch (error) {
      console.error('Fehler beim Versand der Stornierung:', error)
    }
  }
  await fillFreeSeats(rsvp.eventId)
  revalidatePath('/admin', 'layout')
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

  revalidatePath('/admin', 'layout')
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
  // Nur beim Anlegen abgefragt - siehe requireGuestUser-Kommentar in schema.prisma, kommt
  // deshalb bewusst NICHT in updateEventSeries vor.
  const requireGuestUser = formData.get('requireGuestUser') === 'on'

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const series = await prisma.eventSeries.create({
    data: { ownerId: user.id, title, slug, description, askEmail, askPhone, askDiet, askAllergies, requireVerification, isGuestListVisible, eventPin, requireGuestUser }
  })

  revalidatePath('/admin', 'layout')
  redirect(`/admin/series/${series.id}`)
}

/**
 * Aktualisiert die reihenweiten Einstellungen (gilt für alle Termine der Reihe).
 */
export async function updateEventSeries(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  return settingsResult(() => saveEventSeries(formData))
}

async function saveEventSeries(formData: FormData): Promise<string | undefined> {
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
  // Einladungsmodus der Reihe (docs/KONZEPT-EINLADUNGEN.md): gilt für alle Termine, gespiegelt auf Event.inviteOnly
  const inviteOnly = formData.has('inviteOnlyShown') ? formData.get('inviteOnly') === 'on' : existingSeries.inviteOnly
  await assertInviteOnlyAllowed(inviteOnly, { eventPin, requireVerification, requireGuestUser: existingSeries.requireGuestUser }, null, { seriesId: id })
  // Mitbringliste als Vorlage für neue Termine (Idee L5); auf Wunsch auch für kommende Termine ohne eigene Liste
  const bringTemplate = readBringTemplate(formData)

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  await prisma.$transaction([
    prisma.eventSeries.update({
      where: { id },
      data: { title, slug, description, askEmail, askPhone, askDiet, askAllergies, requireVerification, isGuestListVisible, eventPin, inviteOnly, ...(bringTemplate !== undefined ? { bringTemplate } : {}) }
    }),
    prisma.event.updateMany({ where: { seriesId: id }, data: { inviteOnly } })
  ])
  if (bringTemplate && formData.get('bringTemplateApply') === 'on') {
    const upcoming = await prisma.event.findMany({ where: { seriesId: id, date: { gte: new Date() } }, select: { id: true } })
    for (const termin of upcoming) await applyBringTemplate(termin.id, bringTemplate)
  }

  revalidatePath('/admin', 'layout')
  return `/admin/series/${id}/edit?gespeichert=1`
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

  await notifyLinkedToolsBeforeDelete({ eventId: { in: eventIds } })
  await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } })
  await prisma.resourceAccess.deleteMany({ where: { OR: [{ seriesId: id }, { eventId: { in: eventIds } }] } })
  await prisma.event.deleteMany({ where: { seriesId: id } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { seriesId: id } } })
  await prisma.participant.deleteMany({ where: { seriesId: id } })
  await prisma.eventSeries.delete({ where: { id } })

  revalidatePath('/admin', 'layout')
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
  const trackPresence = enableCheckin && formData.get('trackPresence') === 'on'

  const formConfig = JSON.stringify({
    askEmail: false,
    askPhone: false,
    askDiet: false,
    askAllergies: false,
    askAlcohol: formData.get('askAlcohol') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
    customQuestions: readCustomQuestions(formData),
  })

  // URL-Wort: eingegeben oder aus dem Titel, eindeutig gemacht (wie bei createEvent)
  const base = slugify(slugInput?.trim() || title)
  let slug = base
  for (let i = 2; await prisma.event.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`

  const created = await prisma.event.create({
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
      maxCompanions: readMaxCompanions(formData),
      enableCheckin,
      trackPresence,
      // Einladungsmodus kommt von der Reihe (gespiegelt, siehe EventSeries.inviteOnly)
      inviteOnly: series.inviteOnly
    }
  })
  // Mitbringliste aus der Vorlage der Reihe - danach die eigene Liste des Termins
  await applyBringTemplate(created.id, series.bringTemplate)

  revalidatePath('/admin', 'layout')
  redirect(`/admin/events/${created.id}/einstellungen?neu=1&abschnitt=formular`)
}

/**
 * Aktualisiert einen bestehenden Termin innerhalb einer Reihe. Anders als bei
 * updateEvent gibt es hier keine reihenweiten Felder (Profil-Abfragen, PIN,
 * Gästeliste, Verifizierung) - die kommen ausschließlich von der EventSeries.
 */
export async function updateSeriesTermin(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  return settingsResult(() => saveSeriesTermin(formData))
}

async function saveSeriesTermin(formData: FormData): Promise<string | undefined> {
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
  const trackPresence = enableCheckin && formData.get('trackPresence') === 'on'
  const notifyGuests = formData.get('notifyGuests') === 'on'
  const { pollUrl, pollLabel, datePending } = readPollLink(formData)
  const photoUrl = parsePhotoUrl(formData.get('photoUrl') as string || '')
  const feedback = readFeedbackSettings(formData)
  const assembly = await readAssemblySettings(formData, { id, title, assemblyUrl: existingEvent.assemblyUrl })
  const bringSlots = readBringSlots(formData)
  const toolLinks = readToolLinks(formData)
  const ticketing = await readTicketing(formData, id)
  const shiftTiers = await readShiftSettings(formData, id, ticketing)
  const maxCompanions = readMaxCompanions(formData)
  await assertCompanionsAllowed(maxCompanions, ticketing.ticketCategories, id)
  // Termin einer Reihe im Einladungsmodus: keine Ticketkategorien (die übrigen Zugänge regelt die Reihe)
  await assertInviteOnlyAllowed(existingEvent.inviteOnly, { eventPin: null, requireVerification: false, requireGuestUser: false }, ticketing.ticketCategories, { eventId: id })
  assertShiftsAllowed(existingEvent.inviteOnly, toolLinks)
  const menu = readMenu(formData)
  await assertMenuChangeable(id, menu)
  const deadline = readDeadlineSettings(formData)

  const formConfig = JSON.stringify({
    askEmail: false,
    askPhone: false,
    askDiet: false,
    askAllergies: false,
    askAlcohol: formData.get('askAlcohol') === 'on',
    askBringingItem: formData.get('askBringingItem') === 'on',
    customQuestions: readCustomQuestions(formData),
  })

  const slug = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  // Siehe updateEvent: gleiche Diff-Logik, entscheidet über ICS-SEQUENCE und Mail-Versand.
  const changes = diffEventFields(existingEvent, { title, date, duration, location, description })

  await prisma.event.update({
    where: { id },
    data: {
      title, slug, date, location, description, duration, formConfig, autoReminder, reminderDays, maxCapacity, enableCheckin, trackPresence,
      pollUrl, pollLabel, datePending, photoUrl, maxCompanions, ...feedback, ...assembly, ...readProtocolSettings(formData), ...deadline, ...readWishlistSettings(formData),
      ...(ticketing.payment ?? {}),
      ...(ticketing.seatingRequiresPayment !== undefined ? { seatingRequiresPayment: ticketing.seatingRequiresPayment } : {}),
      ...(changes.length > 0 ? { icsSequence: { increment: 1 } } : {})
    }
  })
  // Geänderter oder entfernter Link leert, was das bisherige Tool-Event gemeldet hat (z.B. Plätze)
  await saveToolLinks(id, toolLinks)
  await saveBringSlots(id, bringSlots)
  // "Als Vorlage der Reihe speichern": nur die Vorlage für neue Termine, andere Termine bleiben unberührt
  if (bringSlots !== null && formData.get('bringSaveAsTemplate') === 'on' && existingEvent.seriesId) {
    await prisma.eventSeries.update({ where: { id: existingEvent.seriesId }, data: { bringTemplate: formatBringSlots(bringSlots) || null } })
  }
  await saveMenu(id, menu)
  await resetRemindersOnNewDeadline(id, existingEvent.rsvpDeadline, deadline.rsvpDeadline)
  await applyTicketing(id, ticketing, ticketing.seatingRequiresPayment !== undefined && ticketing.seatingRequiresPayment !== existingEvent.seatingRequiresPayment)
  await saveShiftTiers(id, shiftTiers)

  if (notifyGuests && changes.length > 0) {
    await notifyAttendeesOfChange(id, changes)
  }

  revalidatePath('/admin', 'layout')
  return `/admin/events/${id}/einstellungen?gespeichert=1`
}

/**
 * Manuelles Ein-/Auschecken eines Gasts aus der Gästeliste im Admin-Dashboard
 * (Alternative zum Scannen des QR-Codes, z.B. falls der Gast kein Handy dabei hat).
 * Wie beim Scannen alle zusagenden Personen der Antwort auf einmal (app/lib/checkin.ts).
 */
export async function toggleAttendance(formData: FormData) {
  const user = await requireUser()

  const id = formData.get('rsvpId') as string
  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return

  // Mit Kommen und Gehen (Event.trackPresence) geht, wer da ist; sonst austragen bzw. einlassen
  await toggleAll(id)

  revalidatePath('/admin', 'layout')
  backToCheckin(formData, id)
}

/**
 * Kommen und Gehen (Idee L7): letzte Änderung einer Antwort zurücknehmen - falsch gescannt oder falscher Knopf, damit
 * das Protokoll keine Phantom-Wechsel enthält. Rechte wie beim Scannen.
 */
export async function undoPresence(formData: FormData) {
  const user = await requireUser()
  const id = formData.get('rsvpId') as string
  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { event: true } })
  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event)) || !rsvp.event.trackPresence) return

  await undoLastPresence(id)

  revalidatePath('/admin', 'layout')
  backToCheckin(formData, id)
}

/**
 * Von der Check-in-Seite aus zurück in deren Ansicht ohne automatisches Einchecken - sonst checkte das erneute
 * Laden nach "Austragen" gleich wieder alle ein.
 */
function backToCheckin(formData: FormData, rsvpId: string) {
  if (formData.get('back') === 'checkin') redirect(`/admin/checkin/${rsvpId}?ansicht=1`)
}

/**
 * Einlass einer einzelnen Person (Check-in-Seite und Gästeliste): kommt jemand später oder ist doch nicht da.
 * Nur für feste Plätze auf Terminen mit Check-in, Rechte wie beim Scannen.
 */
export async function togglePersonAttendance(formData: FormData) {
  const user = await requireUser()
  const personId = String(formData.get('personId') ?? '')
  const person = await prisma.rsvpPerson.findUnique({ where: { id: personId }, include: { rsvp: { include: { event: true } } } })
  if (!person || !(await hasEventModeratorOrAbove(user, person.rsvp.event))) return
  if (!person.rsvp.event.enableCheckin || !person.rsvp.isAttending || person.rsvp.isOnWaitlist) return

  await togglePerson(person.id)

  revalidatePath('/admin', 'layout')
  backToCheckin(formData, person.rsvpId)
}

/**
 * Speichert das Push-Abo eines Geräts (Browser-Endpoint + Verschlüsselungs-Keys) für
 * den eingeloggten Nutzer. Wird ein bereits bekannter Endpoint erneut abonniert (z.B.
 * nach Ablauf erneuert), werden einfach die Keys aktualisiert statt einen Duplikat-Eintrag anzulegen.
 */
export async function subscribeToPush(input: PushSubscriptionInput) {
  const user = await requireUser()
  // Nur Push-Dienste der Browser-Hersteller: Der Server schickt später Anfragen an den Endpoint (SSRF-Schutz).
  const subscription = validPushSubscription(input)
  if (!subscription) return

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { p256dh: subscription.p256dh, auth: subscription.auth, userId: user.id },
    create: { ...subscription, userId: user.id }
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
    redirect(eventId ? `/admin/events/${eventId}/einstellungen?shareError=notfound` : `/admin/series/${seriesId}/edit?shareError=notfound`)
  }

  await prisma.resourceAccess.upsert({
    where: eventId
      ? { userId_eventId: { userId: target.id, eventId } }
      : { userId_seriesId: { userId: target.id, seriesId: seriesId! } },
    update: {},
    create: { userId: target.id, eventId, seriesId }
  })

  revalidatePath('/admin', 'layout')
  if (eventId) redirect(`/admin/events/${eventId}/einstellungen`)
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
  revalidatePath('/admin', 'layout')
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

  await notifyLinkedToolsBeforeDelete({ eventId: { in: eventIds } })
  const affectedParticipants = [
    ...await prisma.rsvp.findMany({ where: { eventId: { in: eventIds } }, select: { participantId: true } }),
    ...await prisma.invitation.findMany({ where: { eventId: { in: eventIds } }, select: { participantId: true } })
  ]
  await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } })
  await prisma.resourceAccess.deleteMany({
    where: { OR: [{ userId: targetId }, { eventId: { in: eventIds } }, { seriesId: { in: seriesIds } }] }
  })
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { seriesId: { in: seriesIds } } } })
  await prisma.participant.deleteMany({ where: { seriesId: { in: seriesIds } } })
  // Gäste der Einzel-Events dieses Kontos (die Reihen-Participants sind oben schon weg)
  await deleteOrphanedParticipants(affectedParticipants.map(r => r.participantId))
  await prisma.eventSeries.deleteMany({ where: { id: { in: seriesIds } } })
  await prisma.pushSubscription.deleteMany({ where: { userId: targetId } })
  await prisma.session.deleteMany({ where: { userId: targetId } })
  await prisma.user.delete({ where: { id: targetId } })

  revalidatePath('/admin/users')
}

/**
 * "Neue Adresse jetzt bestätigen" auf /admin/confirm-email (zweiter Schritt von
 * requestEmailChange). Berechtigt ist, wer den an die NEUE Adresse verschickten Token kennt -
 * wie bei resetPassword ohne Sitzung. Nicht schon beim Öffnen des Links: Link-Scanner von
 * Mail-Anbietern rufen Links automatisch ab, und sonst könnte jemand sein Konto auf eine fremde
 * Adresse umstellen, ohne dass deren Besitzer*in etwas tut. Token atomar verbraucht.
 */
export async function confirmEmailChange(formData: FormData) {
  const token = formData.get('token')
  if (typeof token !== 'string' || !token) redirect('/admin/confirm-email?error=invalid')

  const user = await prisma.user.findUnique({ where: { emailChangeToken: hashToken(token) } })
  if (!user || !user.pendingEmail || !user.emailChangeTokenExpiresAt || user.emailChangeTokenExpiresAt < new Date()) {
    redirect('/admin/confirm-email?error=invalid')
  }

  let claimed
  try {
    claimed = await prisma.user.updateMany({
      where: { id: user.id, emailChangeToken: hashToken(token) },
      data: { email: user.pendingEmail, pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null }
    })
  } catch {
    // Die Wunsch-Adresse wurde inzwischen von einem anderen Konto belegt (Unique-Constraint)
    redirect('/admin/confirm-email?error=taken')
  }
  if (claimed.count !== 1) redirect('/admin/confirm-email?error=invalid')
  redirect('/admin/confirm-email?done=1')
}
